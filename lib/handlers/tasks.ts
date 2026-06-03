import { getAuthFailureResponse, getSafeUserById, requireAuthFromAuthorizationHeader } from '../auth.js';
import { randomUUID } from 'node:crypto';
import { buildTasksIcs, type CalendarTask } from '../calendar/ics.js';
import {
  ensureCalendarIntegrationSchema,
} from '../calendar/calendarSync.js';
import {
  assertCalendarFeedActive,
  createCalendarFeedToken,
  revokeActiveCalendarFeeds,
} from '../calendar/calendarFeeds.js';
import {
  buildHolidayCalendar,
  detectBrazilLocationFromCoordinates,
  ensureHolidayLocationSchema,
} from '../holidays.js';
import { assertInfrastructure } from '../infrastructure.js';
import { logError, logInfo, logWarn } from '../logger.js';
import {
  ensureNotificationSchedulingInfrastructure,
} from '../notification-schedules.js';
import {
  createTaskCategorySchema,
  createTaskSchema,
  createTaskTagSchema,
  detectHolidayLocationSchema,
  formatZodError,
  updateTaskSchema,
} from '../schemas.js';
import {
  deleteUserCategory,
  deleteUserTag,
  ensureTaskTaxonomySchema,
  getTaskTaxonomy,
  sanitizeTaskTags,
  upsertUserCategory,
  upsertUserTags,
} from '../task-taxonomy.js';
import {
  enqueueTaskSideEffect,
  ensureTaskSideEffectsInfrastructure,
} from '../task-side-effects.js';
import { checkRateLimit } from '../../api/_rate_limit.js';
import { verifyCalendarFeedToken } from '../jwt.js';
import type { OverdueReminderIntensity } from '../contracts.js';
import {
  type HandlerContext,
  type HandlerResult,
  getRequestIp,
  getRequestMeta,
  json,
  methodNotAllowed,
} from './core.js';

type TaskHistoryAction = 'created' | 'updated' | 'rescheduled' | 'completed' | 'reopened';

interface TaskHistoryEntry {
  id: string;
  action: TaskHistoryAction;
  title: string;
  description: string;
  createdAt: string;
  details?: string[];
}

const TASK_LIST_DEFAULT_LIMIT = 50;
const TASK_LIST_MAX_LIMIT = 100;

type TaskListStatusFilter = 'pending' | 'overdue' | 'completed' | 'inactive' | 'cancelled';
type TaskListPriorityFilter = 'low' | 'medium' | 'high';
type TaskListSort = 'created' | 'dueDate' | 'priority' | 'category';

const PRIORITY_HISTORY_LABELS: Record<string, string> = {
  low: 'baixa',
  medium: 'média',
  high: 'alta',
};
const OVERDUE_INTENSITY_HISTORY_LABELS: Record<OverdueReminderIntensity, string> = {
  gentle: 'suave',
  normal: 'normal',
  insistent: 'insistente',
  silent: 'silenciosa',
};
const WORK_TIME_REQUIRED_MESSAGE = 'Horário inicial e horário final são obrigatórios para categoria Trabalho.';
const WORK_END_AFTER_START_MESSAGE = 'Horário final precisa ser depois do horário inicial.';

let taskInfrastructureReady: Promise<void> | null = null;

async function ensureTaskInfrastructure(sql: HandlerContext['sql']) {
  taskInfrastructureReady ??= (async () => {
    await ensureTaskTaxonomySchema(sql);
    await ensureCalendarIntegrationSchema(sql);
    await ensureTaskSideEffectsInfrastructure(sql);
    await ensureNotificationSchedulingInfrastructure(sql);
    await assertInfrastructure(sql, 'task list indexes', {
      columns: [
        { table: 'tasks', column: 'client_mutation_id' },
      ],
      indexes: [
        { name: 'idx_tasks_user_deleted_status_created' },
        { name: 'idx_tasks_user_deleted_status_due' },
        { name: 'idx_tasks_user_priority_due' },
        { name: 'idx_tasks_user_category_due' },
        { name: 'idx_tasks_search_gin' },
        { name: 'idx_tasks_user_client_mutation_id' },
      ],
    });
  })().catch((error) => {
    taskInfrastructureReady = null;
    throw error;
  });

  return taskInfrastructureReady;
}

function resolveTaskId(context: HandlerContext): string | null {
  const paramId = context.request.params?.id;
  if (paramId) return paramId;

  const queryId = context.request.query?.id;
  if (typeof queryId === 'string') return queryId;
  if (Array.isArray(queryId) && typeof queryId[0] === 'string') return queryId[0];
  return null;
}

async function requireTaskAuth(context: HandlerContext) {
  try {
    return await requireAuthFromAuthorizationHeader(
      context.sql,
      context.request.headers.authorization as string | undefined,
    );
  } catch (error) {
    const authFailure = getAuthFailureResponse(error);
    if (authFailure) {
      return json(authFailure.status, { error: authFailure.error });
    }

    logError('task_auth_failed', error, getRequestMeta(context.request));
    return json(500, { error: 'Erro interno ao autenticar' });
  }
}

function getQueryStringValue(context: HandlerContext, key: string): string | null {
  const value = context.request.query?.[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function parseBoundedPositiveInteger(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;

  return Math.min(parsed, max);
}

function normalizeTaskListStatus(value: string | null): TaskListStatusFilter | null {
  if (
    value === 'pending' ||
    value === 'overdue' ||
    value === 'completed' ||
    value === 'inactive' ||
    value === 'cancelled'
  ) {
    return value;
  }

  return null;
}

function normalizeTaskListPriority(value: string | null): TaskListPriorityFilter | null {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return null;
}

function normalizeTaskListSort(value: string | null): TaskListSort {
  if (value === 'dueDate' || value === 'priority' || value === 'category' || value === 'created') {
    return value;
  }

  return 'created';
}

function normalizeOptionalTaskListText(value: string | null, maxLength = 80): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeOptionalTaskListDate(value: string | null): string | null {
  const normalized = normalizeOptionalTaskListText(value, 32);
  if (!normalized) return null;

  return Number.isNaN(Date.parse(normalized)) ? null : normalized;
}

async function requireTaskCalendarAuth(context: HandlerContext) {
  const feedToken = getQueryStringValue(context, 'token');

  if (feedToken) {
    try {
      const payload = verifyCalendarFeedToken(feedToken);
      await assertCalendarFeedActive(context.sql, payload);
      const user = await getSafeUserById(context.sql, payload.sub);
      if (!user) return json(401, { error: 'Usuário não encontrado' });
      return { payload, user, token: feedToken };
    } catch (error) {
      logError('task_calendar_feed_auth_failed', error, getRequestMeta(context.request));
      return json(401, { error: 'Link de calendário inválido' });
    }
  }

  return requireTaskAuth(context);
}

async function syncTaskTaxonomy(sql: HandlerContext['sql'], userId: string, category: string, tags: string[]) {
  await upsertUserCategory(sql, userId, category);
  await upsertUserTags(sql, userId, tags);
}

async function syncTaskTaxonomyBestEffort(
  context: HandlerContext,
  userId: string,
  taskId: string,
  category: string,
  tags: string[],
) {
  try {
    await syncTaskTaxonomy(context.sql, userId, category, tags);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string' &&
      (error.message.includes('user_categories_user_id_fkey') || error.message.includes('user_tags_user_id_fkey'))
    ) {
      return;
    }

    logError('task_taxonomy_sync_failed', error, getRequestMeta(context.request, { userId, taskId }));
  }
}

async function enqueueTaskMutationSideEffectBestEffort(
  context: HandlerContext,
  userId: string,
  taskId: string,
  kind: 'sync_notification_schedules' | 'cancel_notification_schedules' | 'sync_external_calendar' | 'delete_external_calendar_event',
  caller: string,
) {
  try {
    await enqueueTaskSideEffect(context.sql, { userId, taskId, kind });
  } catch (error) {
    logError('task_side_effect_enqueue_failed', error, getRequestMeta(context.request, {
      userId,
      taskId,
      kind,
      caller,
    }));
  }
}

function createHistoryEntry(
  action: TaskHistoryAction,
  title: string,
  description: string,
  details: string[] = [],
): TaskHistoryEntry {
  return {
    id: randomUUID(),
    action,
    title,
    description,
    createdAt: new Date().toISOString(),
    ...(details.length > 0 ? { details } : {}),
  };
}

function jsonbParameter(sql: HandlerContext['sql'], value: unknown) {
  return sql.json ? sql.json(value) : JSON.stringify(value);
}

function normalizeDateValue(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function normalizeCategoryForValidation(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

function isWorkCategory(value: string): boolean {
  return normalizeCategoryForValidation(value) === 'trabalho';
}

function requiresWorkScheduleForUpdate(input: {
  categoryChanged: boolean;
  dueDateChanged: boolean;
  endDateChanged: boolean;
  nextDueDate: unknown;
  nextEndDate: unknown;
  nextStatus: unknown;
}) {
  const status = String(input.nextStatus ?? 'pending');
  if (status !== 'pending' && status !== 'overdue') return false;
  if (input.categoryChanged) return !input.nextDueDate || !input.nextEndDate;
  if (input.dueDateChanged && !input.nextDueDate) return true;
  if (input.endDateChanged && !input.nextEndDate) return true;
  return false;
}

function normalizeOverdueReminderIntensity(value: unknown): OverdueReminderIntensity {
  if (value === 'gentle' || value === 'normal' || value === 'insistent' || value === 'silent') {
    return value;
  }

  return 'normal';
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function buildCreatedHistoryEntry(input: {
  dueDate?: string | null;
  endDate?: string | null;
  priority: string;
  category: string;
  tags: string[];
  alarmEnabled: boolean;
  preNoticeMinutes?: number | null;
  overdueReminderIntensity: OverdueReminderIntensity;
  status: string;
}): TaskHistoryEntry {
  const details = [
    input.dueDate ? 'Prazo inicial definido.' : 'Criado sem prazo definido.',
    `Prioridade inicial: ${PRIORITY_HISTORY_LABELS[input.priority] ?? input.priority}.`,
    `Categoria inicial: ${input.category}.`,
  ];

  if (input.tags.length > 0) {
    details.push(`Tags iniciais: ${input.tags.join(', ')}.`);
  }

  if (input.alarmEnabled) {
    details.push('Alarme ativado.');
  }

  if (input.dueDate) {
    details.push(`Pré-aviso: ${input.preNoticeMinutes ?? 15} min antes.`);
  }

  if (input.overdueReminderIntensity !== 'normal') {
    details.push(`Avisos de atraso: ${OVERDUE_INTENSITY_HISTORY_LABELS[input.overdueReminderIntensity]}.`);
  }

  if (input.endDate) {
    details.push('Horário final definido.');
  }

  if (input.status === 'draft') {
    details.push('Salvo como rascunho.');
    return createHistoryEntry('created', 'Rascunho criado', 'O lembrete foi salvo como rascunho.', details);
  }

  if (input.status === 'inactive') {
    details.push('Criado desativado.');
    return createHistoryEntry('created', 'Lembrete desativado criado', 'O lembrete foi registrado desativado.', details);
  }

  return createHistoryEntry('created', 'Lembrete criado', 'O lembrete foi registrado.', details);
}

function buildUpdateHistoryEntry(
  current: Record<string, unknown>,
  next: {
    title: unknown;
    description: unknown;
    dueDate: unknown;
    endDate: unknown;
    priority: unknown;
    category: unknown;
    tags: string[];
    suppressHolidayNotifications: unknown;
    alarmEnabled: unknown;
    preNoticeMinutes: unknown;
    overdueReminderIntensity: unknown;
    status: unknown;
  },
): TaskHistoryEntry | null {
  const changedDetails: string[] = [];
  const currentTags = normalizeStringArray(current.tags);

  if (String(current.title ?? '') !== String(next.title ?? '')) changedDetails.push('Título atualizado.');
  if (String(current.description ?? '') !== String(next.description ?? '')) changedDetails.push('Descrição atualizada.');
  if (normalizeDateValue(current.due_date) !== normalizeDateValue(next.dueDate)) changedDetails.push('Prazo alterado.');
  if (normalizeDateValue(current.end_date) !== normalizeDateValue(next.endDate)) changedDetails.push('Horário final alterado.');
  if (String(current.priority ?? '') !== String(next.priority ?? '')) changedDetails.push('Prioridade alterada.');
  if (String(current.category ?? '') !== String(next.category ?? '')) changedDetails.push('Categoria alterada.');
  if (!areStringArraysEqual(currentTags, next.tags)) changedDetails.push('Tags atualizadas.');
  if (Boolean(current.suppress_holiday_notifications) !== Boolean(next.suppressHolidayNotifications)) {
    changedDetails.push('Preferência de notificações em feriados alterada.');
  }
  if (Boolean(current.alarm_enabled) !== Boolean(next.alarmEnabled)) {
    changedDetails.push('Configuração de alarme alterada.');
  }
  if (Number(current.pre_notice_minutes ?? 15) !== Number(next.preNoticeMinutes ?? 15)) {
    changedDetails.push('Tempo de pré-aviso alterado.');
  }
  if (
    normalizeOverdueReminderIntensity(current.overdue_reminder_intensity) !==
    normalizeOverdueReminderIntensity(next.overdueReminderIntensity)
  ) {
    changedDetails.push('Intensidade dos avisos de atraso alterada.');
  }
  if (String(current.status ?? '') !== String(next.status ?? '')) changedDetails.push('Status alterado.');

  if (changedDetails.length === 0) return null;

  const currentStatus = String(current.status ?? 'pending');
  const nextStatus = String(next.status ?? currentStatus);
  const dueDateChanged =
    normalizeDateValue(current.due_date) !== normalizeDateValue(next.dueDate) ||
    normalizeDateValue(current.end_date) !== normalizeDateValue(next.endDate);
  const onlyStatusChanged = changedDetails.length === 1 && changedDetails[0] === 'Status alterado.';

  if (onlyStatusChanged && currentStatus !== nextStatus) {
    if (nextStatus === 'completed') {
      return createHistoryEntry('completed', 'Lembrete concluído', 'O usuário marcou este lembrete como concluído.');
    }

    return createHistoryEntry('reopened', 'Lembrete reaberto', 'O usuário devolveu este lembrete para pendente.');
  }

  if (dueDateChanged) {
    return createHistoryEntry('rescheduled', 'Prazo reagendado', 'O prazo do lembrete foi atualizado.', changedDetails);
  }

  return createHistoryEntry('updated', 'Lembrete atualizado', 'As informações do lembrete foram alteradas.', changedDetails);
}

function resolveCalendarYear(context: HandlerContext) {
  const queryYear = context.request.query?.year;
  const rawYear = typeof queryYear === 'string'
    ? queryYear
    : Array.isArray(queryYear) && typeof queryYear[0] === 'string'
      ? queryYear[0]
      : null;

  const yearValue = rawYear ? Number.parseInt(rawYear, 10) : new Date().getFullYear();
  return Number.isFinite(yearValue) ? yearValue : new Date().getFullYear();
}

function resolveNameValue(context: HandlerContext): string {
  const queryName = context.request.query?.name;
  if (typeof queryName === 'string') return queryName;
  if (Array.isArray(queryName) && typeof queryName[0] === 'string') return queryName[0];

  const bodyName = context.request.body && typeof context.request.body === 'object' && 'name' in context.request.body
    ? (context.request.body as { name?: unknown }).name
    : undefined;

  return typeof bodyName === 'string' ? bodyName : '';
}

export async function handleTasksCollection(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  await ensureTaskInfrastructure(sql);

  if (request.method === 'GET') {
    try {
      const page = parseBoundedPositiveInteger(getQueryStringValue(context, 'page'), 1, Number.MAX_SAFE_INTEGER);
      const limit = parseBoundedPositiveInteger(
        getQueryStringValue(context, 'limit'),
        TASK_LIST_DEFAULT_LIMIT,
        TASK_LIST_MAX_LIMIT,
      );
      const offset = (page - 1) * limit;
      const statusFilter = normalizeTaskListStatus(getQueryStringValue(context, 'status'));
      const priorityFilter = normalizeTaskListPriority(getQueryStringValue(context, 'priority'));
      const sort = normalizeTaskListSort(getQueryStringValue(context, 'sort'));
      const search = normalizeOptionalTaskListText(getQueryStringValue(context, 'search'));
      const category = normalizeOptionalTaskListText(getQueryStringValue(context, 'category'));
      const tag = normalizeOptionalTaskListText(getQueryStringValue(context, 'tag'));
      const dueStart = normalizeOptionalTaskListDate(getQueryStringValue(context, 'dueStart'));
      const dueEnd = normalizeOptionalTaskListDate(getQueryStringValue(context, 'dueEnd'));
      const searchPattern = search ? `%${search}%` : null;

      const countRows = await sql`
        SELECT COUNT(*) AS total
        FROM tasks
        WHERE user_id = ${user.id}
          AND deleted_at IS NULL
          AND (${statusFilter === 'cancelled'} OR status <> 'cancelled')
          AND (${statusFilter}::text IS NULL OR (
            (${statusFilter} = 'completed' AND status = 'completed')
            OR (${statusFilter} = 'inactive' AND status = 'inactive')
            OR (${statusFilter} = 'cancelled' AND status = 'cancelled')
            OR (${statusFilter} = 'overdue' AND status IN ('pending', 'overdue') AND due_date IS NOT NULL AND due_date < NOW())
            OR (${statusFilter} = 'pending' AND status IN ('pending', 'overdue') AND (due_date IS NULL OR due_date >= NOW()))
          ))
          AND (${priorityFilter}::text IS NULL OR priority = ${priorityFilter})
          AND (${category}::text IS NULL OR category = ${category})
          AND (${tag}::text IS NULL OR ${tag} = ANY(tags))
          AND (${dueStart}::text IS NULL OR due_date >= ${dueStart}::timestamptz)
          AND (${dueEnd}::text IS NULL OR due_date <= ${dueEnd}::timestamptz)
          AND (${search}::text IS NULL OR (
            to_tsvector(
              'simple',
              coalesce(title, '') || ' ' ||
              coalesce(description, '') || ' ' ||
              coalesce(category, '')
            ) @@ plainto_tsquery('simple', ${search})
            OR title ILIKE ${searchPattern}
            OR description ILIKE ${searchPattern}
            OR category ILIKE ${searchPattern}
            OR array_to_string(tags, ' ') ILIKE ${searchPattern}
          ))
      `;
      const total = Number(countRows[0]?.total ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const rows = await sql`
        SELECT
          id,
          user_id     AS "userId",
          client_mutation_id AS "clientMutationId",
          title,
          description,
          due_date    AS "dueDate",
          end_date    AS "endDate",
          priority,
          category,
          tags,
          suppress_holiday_notifications AS "suppressHolidayNotifications",
          overdue_reminder_intensity AS "overdueReminderIntensity",
          alarm_enabled AS "alarmEnabled",
          pre_notice_minutes AS "preNoticeMinutes",
          reminder_mode AS "reminderMode",
          expires_at AS "expiresAt",
          overdue_since AS "overdueSince",
          overdue_expires_at AS "overdueExpiresAt",
          deleted_at AS "deletedAt",
          completed_at AS "completedAt",
          completion_source AS "completionSource",
          auto_deleted_reason AS "autoDeletedReason",
          auto_deleted_at AS "autoDeletedAt",
          muted_until AS "mutedUntil",
          status,
          history,
          created_at  AS "createdAt",
          external_calendar_provider AS "externalCalendarProvider",
          external_calendar_event_id AS "externalCalendarEventId",
          external_calendar_sync_status AS "externalCalendarSyncStatus",
          external_calendar_last_error AS "externalCalendarLastError",
          external_calendar_synced_at AS "externalCalendarSyncedAt"
        FROM tasks
        WHERE user_id = ${user.id}
          AND deleted_at IS NULL
          AND (${statusFilter === 'cancelled'} OR status <> 'cancelled')
          AND (${statusFilter}::text IS NULL OR (
            (${statusFilter} = 'completed' AND status = 'completed')
            OR (${statusFilter} = 'inactive' AND status = 'inactive')
            OR (${statusFilter} = 'cancelled' AND status = 'cancelled')
            OR (${statusFilter} = 'overdue' AND status IN ('pending', 'overdue') AND due_date IS NOT NULL AND due_date < NOW())
            OR (${statusFilter} = 'pending' AND status IN ('pending', 'overdue') AND (due_date IS NULL OR due_date >= NOW()))
          ))
          AND (${priorityFilter}::text IS NULL OR priority = ${priorityFilter})
          AND (${category}::text IS NULL OR category = ${category})
          AND (${tag}::text IS NULL OR ${tag} = ANY(tags))
          AND (${dueStart}::text IS NULL OR due_date >= ${dueStart}::timestamptz)
          AND (${dueEnd}::text IS NULL OR due_date <= ${dueEnd}::timestamptz)
          AND (${search}::text IS NULL OR (
            to_tsvector(
              'simple',
              coalesce(title, '') || ' ' ||
              coalesce(description, '') || ' ' ||
              coalesce(category, '')
            ) @@ plainto_tsquery('simple', ${search})
            OR title ILIKE ${searchPattern}
            OR description ILIKE ${searchPattern}
            OR category ILIKE ${searchPattern}
            OR array_to_string(tags, ' ') ILIKE ${searchPattern}
          ))
        ORDER BY
          CASE WHEN ${sort} = 'dueDate' THEN due_date END ASC NULLS LAST,
          CASE WHEN ${sort} = 'dueDate' THEN
            CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END
          END ASC,
          CASE WHEN ${sort} = 'priority' THEN
            CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END
          END ASC,
          CASE WHEN ${sort} = 'priority' THEN due_date END ASC NULLS LAST,
          CASE WHEN ${sort} = 'category' THEN lower(category) END ASC,
          CASE WHEN ${sort} = 'category' THEN due_date END ASC NULLS LAST,
          CASE WHEN ${sort} = 'created' THEN created_at END DESC,
          created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      return json(200, {
        items: rows,
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
        sort,
        filters: {
          status: statusFilter,
          search,
          priority: priorityFilter,
          category,
          tag,
          dueStart,
          dueEnd,
        },
      });
    } catch (error) {
      logError('tasks_list_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao buscar tarefas' });
    }
  }

  if (request.method === 'POST') {
    const rateLimit = await checkRateLimit(getRequestIp(request), 'bulk_create');
    if (!rateLimit.allowed) {
      const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
      logWarn('tasks_create_rate_limited', getRequestMeta(request, {
        userId: user.id,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      }));
      return json(429, {
        error: `Muitas criações em sequência. Tente novamente em ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    const parsed = createTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

    const {
      clientMutationId,
      title,
      description,
      dueDate,
      endDate,
      priority,
      category,
      status,
      suppressHolidayNotifications,
      alarmEnabled,
      overdueReminderIntensity,
      mutedUntil,
      preNoticeMinutes,
      noTimeReminderMinutes,
    } = parsed.data;
    const tags = sanitizeTaskTags(parsed.data.tags);
    const effectiveDueDate = dueDate || null;
    const effectiveEndDate = effectiveDueDate ? endDate || null : null;
    const effectiveAlarmEnabled = Boolean(effectiveDueDate && alarmEnabled);
    const history = jsonbParameter(sql, [
      buildCreatedHistoryEntry({
        dueDate: effectiveDueDate,
        endDate: effectiveEndDate,
        priority,
        category,
        tags,
        alarmEnabled: effectiveAlarmEnabled,
        preNoticeMinutes: effectiveDueDate ? preNoticeMinutes ?? 15 : null,
        overdueReminderIntensity,
        status,
      }),
    ]);

    const totalStartedAt = Date.now();
    logInfo('tasks:create:start', getRequestMeta(request, {
      userId: user.id,
      hasDueDate: Boolean(effectiveDueDate),
      status,
    }));
    try {
      const dbStartedAt = Date.now();
      const rows = await sql`
        INSERT INTO tasks (
          user_id,
          client_mutation_id,
          title,
          description,
          due_date,
          end_date,
          priority,
          category,
          tags,
          suppress_holiday_notifications,
          overdue_reminder_intensity,
          alarm_enabled,
          pre_notice_minutes,
          reminder_mode,
          expires_at,
          muted_until,
          floating_interval_minutes,
          status,
          external_calendar_sync_status,
          history
        )
        VALUES (
          ${user.id},
          ${clientMutationId ?? null},
          ${title},
          ${description},
          ${effectiveDueDate},
          ${effectiveEndDate},
          ${priority},
          ${category},
          ${tags},
          ${suppressHolidayNotifications},
          ${overdueReminderIntensity},
          ${effectiveAlarmEnabled},
          ${effectiveDueDate ? preNoticeMinutes ?? 15 : null},
          ${effectiveDueDate ? 'timed' : 'floating'},
          ${effectiveDueDate ? null : new Date(Date.now() + 24 * 60 * 60 * 1000)},
          ${mutedUntil || null},
          ${effectiveDueDate ? null : noTimeReminderMinutes ?? 60},
          ${status},
          ${effectiveDueDate && status === 'pending' ? 'pending' : 'idle'},
          ${history}::jsonb
        )
        ON CONFLICT (user_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL
        DO UPDATE SET client_mutation_id = EXCLUDED.client_mutation_id
        RETURNING
          id,
          user_id     AS "userId",
          client_mutation_id AS "clientMutationId",
          title,
          description,
          due_date    AS "dueDate",
          end_date    AS "endDate",
          priority,
          category,
          tags,
          suppress_holiday_notifications AS "suppressHolidayNotifications",
          overdue_reminder_intensity AS "overdueReminderIntensity",
          alarm_enabled AS "alarmEnabled",
          pre_notice_minutes AS "preNoticeMinutes",
          reminder_mode AS "reminderMode",
          expires_at AS "expiresAt",
          overdue_since AS "overdueSince",
          overdue_expires_at AS "overdueExpiresAt",
          deleted_at AS "deletedAt",
          completed_at AS "completedAt",
          completion_source AS "completionSource",
          auto_deleted_reason AS "autoDeletedReason",
          auto_deleted_at AS "autoDeletedAt",
          muted_until AS "mutedUntil",
         status,
          history,
          created_at  AS "createdAt",
          external_calendar_provider AS "externalCalendarProvider",
          external_calendar_event_id AS "externalCalendarEventId",
          external_calendar_sync_status AS "externalCalendarSyncStatus",
          external_calendar_last_error AS "externalCalendarLastError",
          external_calendar_synced_at AS "externalCalendarSyncedAt"
      `;
      const dbMs = Date.now() - dbStartedAt;

      const taskId = String(rows[0].id);
      const enqueueStartedAt = Date.now();
      await enqueueTaskMutationSideEffectBestEffort(
        context,
        user.id,
        taskId,
        'sync_notification_schedules',
        'handleTasksCollection:create',
      );
      if (effectiveDueDate && status === 'pending') {
        await enqueueTaskMutationSideEffectBestEffort(
          context,
          user.id,
          taskId,
          'sync_external_calendar',
          'handleTasksCollection:create',
        );
      }
      const enqueueMs = Date.now() - enqueueStartedAt;

      void syncTaskTaxonomyBestEffort(context, user.id, taskId, category, tags);
      const totalMs = Date.now() - totalStartedAt;
      logInfo('tasks:create:insert-ms', getRequestMeta(request, { userId: user.id, taskId, durationMs: dbMs }));
      logInfo('tasks:create:enqueue-ms', getRequestMeta(request, { userId: user.id, taskId, durationMs: enqueueMs }));
      logInfo('tasks:create:response-total-ms', getRequestMeta(request, { userId: user.id, taskId, durationMs: totalMs }));
      logInfo('task_created', getRequestMeta(request, { userId: user.id, taskId }));
      return json(201, rows[0]);
    } catch (error) {
      logError('task_create_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao criar tarefa' });
    }
  }

  return methodNotAllowed();
}

export async function handleTaskById(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  const id = resolveTaskId(context);

  await ensureTaskInfrastructure(sql);

  if (!id) {
    return json(400, { error: 'Tarefa não encontrada' });
  }

  if (request.method === 'GET') {
    try {
      const rows = await sql`
        SELECT
          id,
          user_id     AS "userId",
          client_mutation_id AS "clientMutationId",
          title,
          description,
          due_date    AS "dueDate",
          end_date    AS "endDate",
          priority,
          category,
          tags,
          suppress_holiday_notifications AS "suppressHolidayNotifications",
          overdue_reminder_intensity AS "overdueReminderIntensity",
          alarm_enabled AS "alarmEnabled",
          pre_notice_minutes AS "preNoticeMinutes",
          reminder_mode AS "reminderMode",
          expires_at AS "expiresAt",
          overdue_since AS "overdueSince",
          overdue_expires_at AS "overdueExpiresAt",
          deleted_at AS "deletedAt",
          completed_at AS "completedAt",
          completion_source AS "completionSource",
          auto_deleted_reason AS "autoDeletedReason",
          auto_deleted_at AS "autoDeletedAt",
          muted_until AS "mutedUntil",
          status,
          history,
          created_at  AS "createdAt",
          external_calendar_provider AS "externalCalendarProvider",
          external_calendar_event_id AS "externalCalendarEventId",
          external_calendar_sync_status AS "externalCalendarSyncStatus",
          external_calendar_last_error AS "externalCalendarLastError",
          external_calendar_synced_at AS "externalCalendarSyncedAt"
        FROM tasks
        WHERE id = ${id}
          AND user_id = ${user.id}
          AND deleted_at IS NULL
      `;

      if (rows.length === 0) {
        return json(404, { error: 'Tarefa nÃ£o encontrada' });
      }

      return json(200, rows[0]);
    } catch (error) {
      logError('task_get_failed', error, getRequestMeta(request, { userId: user.id, taskId: id }));
      return json(500, { error: 'Erro ao buscar tarefa' });
    }
  }

  if (request.method === 'PUT') {
    const parsed = updateTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

      const {
        title,
        description,
        dueDate,
        endDate,
        priority,
        category,
        status,
        alarmEnabled,
        suppressHolidayNotifications,
        overdueReminderIntensity,
        mutedUntil,
        preNoticeMinutes,
        noTimeReminderMinutes,
      } = parsed.data;
      const nextTags = parsed.data.tags ? sanitizeTaskTags(parsed.data.tags) : undefined;

      const totalStartedAt = Date.now();
      try {
        const current = await sql`
        SELECT
          title,
          description,
          due_date,
          end_date,
          priority,
          category,
          tags,
          status,
          alarm_enabled,
          pre_notice_minutes,
          suppress_holiday_notifications,
          overdue_reminder_intensity,
          muted_until,
          floating_interval_minutes,
          external_calendar_event_id,
          history
        FROM tasks WHERE id = ${id} AND user_id = ${user.id}
      `;
      if (current.length === 0) {
        return json(404, { error: 'Tarefa não encontrada' });
      }

      const cur = current[0] as Record<string, unknown>;
      const categoryValue = category !== undefined ? category : String(cur.category ?? 'Geral');
      const tagsValue = nextTags ?? ((cur.tags as string[] | undefined) ?? []);
      const nextValues = {
        title: title !== undefined ? title : cur.title,
        description: description !== undefined ? description : cur.description,
        dueDate: dueDate !== undefined ? dueDate || null : cur.due_date,
        endDate: endDate !== undefined ? endDate || null : cur.end_date,
        priority: priority !== undefined ? priority : cur.priority,
        category: categoryValue,
        tags: tagsValue,
        suppressHolidayNotifications: suppressHolidayNotifications !== undefined
          ? suppressHolidayNotifications
          : cur.suppress_holiday_notifications,
        alarmEnabled: alarmEnabled !== undefined ? alarmEnabled : cur.alarm_enabled,
        preNoticeMinutes: preNoticeMinutes !== undefined ? preNoticeMinutes : cur.pre_notice_minutes,
        overdueReminderIntensity: overdueReminderIntensity !== undefined
          ? overdueReminderIntensity
          : normalizeOverdueReminderIntensity(cur.overdue_reminder_intensity),
        mutedUntil: mutedUntil !== undefined ? mutedUntil || null : cur.muted_until,
        floatingIntervalMinutes: noTimeReminderMinutes !== undefined
          ? noTimeReminderMinutes
          : cur.floating_interval_minutes,
        status: status !== undefined ? status : cur.status,
      };
      if (!nextValues.dueDate) {
        nextValues.endDate = null;
        nextValues.alarmEnabled = false;
        nextValues.preNoticeMinutes = null;
      }
      if (
        isWorkCategory(String(nextValues.category)) &&
        requiresWorkScheduleForUpdate({
          categoryChanged: category !== undefined,
          dueDateChanged: dueDate !== undefined,
          endDateChanged: endDate !== undefined,
          nextDueDate: nextValues.dueDate,
          nextEndDate: nextValues.endDate,
          nextStatus: nextValues.status,
        })
      ) {
        return json(400, { error: WORK_TIME_REQUIRED_MESSAGE });
      }
      if (
        nextValues.dueDate &&
        nextValues.endDate &&
        Date.parse(String(nextValues.endDate)) <= Date.parse(String(nextValues.dueDate))
      ) {
        return json(400, { error: WORK_END_AFTER_START_MESSAGE });
      }
      const historyEntry = buildUpdateHistoryEntry(cur, nextValues);
      const historyUpdate = historyEntry ? jsonbParameter(sql, [historyEntry]) : null;

      const rows = await sql`
        UPDATE tasks SET
          title       = ${nextValues.title},
          description = ${nextValues.description},
          due_date    = ${nextValues.dueDate},
          end_date    = ${nextValues.endDate},
          priority    = ${nextValues.priority},
          category    = ${nextValues.category},
          tags        = ${nextValues.tags},
          suppress_holiday_notifications = ${nextValues.suppressHolidayNotifications},
          overdue_reminder_intensity = ${nextValues.overdueReminderIntensity},
          alarm_enabled = ${nextValues.alarmEnabled},
          pre_notice_minutes = ${nextValues.dueDate ? nextValues.preNoticeMinutes ?? 15 : null},
          reminder_mode = ${nextValues.dueDate ? 'timed' : 'floating'},
          expires_at = CASE
            WHEN ${nextValues.dueDate}::timestamptz IS NULL THEN COALESCE(expires_at, NOW() + INTERVAL '24 hours')
            ELSE NULL
          END,
          overdue_since = CASE
            WHEN ${nextValues.dueDate}::timestamptz IS NULL THEN NULL
            WHEN ${nextValues.status} = 'pending' AND ${nextValues.dueDate}::timestamptz > NOW() THEN NULL
            ELSE overdue_since
          END,
          overdue_expires_at = CASE
            WHEN ${nextValues.dueDate}::timestamptz IS NULL THEN NULL
            WHEN ${nextValues.status} = 'pending' AND ${nextValues.dueDate}::timestamptz > NOW() THEN NULL
            ELSE overdue_expires_at
          END,
          muted_until = ${nextValues.mutedUntil},
          floating_interval_minutes = ${nextValues.dueDate ? null : nextValues.floatingIntervalMinutes ?? 60},
          status      = ${nextValues.status},
          completed_at = CASE
            WHEN ${nextValues.status} = 'completed' THEN COALESCE(completed_at, NOW())
            WHEN ${nextValues.status} IN ('pending', 'overdue') THEN NULL
            ELSE completed_at
          END,
          completion_source = CASE
            WHEN ${nextValues.status} = 'completed' THEN 'user'
            WHEN ${nextValues.status} IN ('pending', 'overdue') THEN NULL
            ELSE completion_source
          END,
          external_calendar_sync_status = CASE
            WHEN (
              (${nextValues.status} = 'pending' AND ${nextValues.dueDate}::timestamptz IS NOT NULL)
              OR external_calendar_event_id IS NOT NULL
            ) THEN 'pending'
            ELSE external_calendar_sync_status
          END,
          external_calendar_last_error = CASE
            WHEN (
              (${nextValues.status} = 'pending' AND ${nextValues.dueDate}::timestamptz IS NOT NULL)
              OR external_calendar_event_id IS NOT NULL
            ) THEN NULL
            ELSE external_calendar_last_error
          END,
          history     = COALESCE(history, '[]'::jsonb) || COALESCE(${historyUpdate}::jsonb, '[]'::jsonb)
        WHERE id = ${id} AND user_id = ${user.id}
        RETURNING
          id,
          user_id     AS "userId",
          client_mutation_id AS "clientMutationId",
          title,
          description,
          due_date    AS "dueDate",
          end_date    AS "endDate",
          priority,
          category,
          tags,
          suppress_holiday_notifications AS "suppressHolidayNotifications",
          overdue_reminder_intensity AS "overdueReminderIntensity",
          alarm_enabled AS "alarmEnabled",
          pre_notice_minutes AS "preNoticeMinutes",
          reminder_mode AS "reminderMode",
          expires_at AS "expiresAt",
          overdue_since AS "overdueSince",
          overdue_expires_at AS "overdueExpiresAt",
          deleted_at AS "deletedAt",
          completed_at AS "completedAt",
          completion_source AS "completionSource",
          auto_deleted_reason AS "autoDeletedReason",
          auto_deleted_at AS "autoDeletedAt",
          muted_until AS "mutedUntil",
          status,
          history,
          created_at  AS "createdAt",
          external_calendar_provider AS "externalCalendarProvider",
          external_calendar_event_id AS "externalCalendarEventId",
          external_calendar_sync_status AS "externalCalendarSyncStatus",
          external_calendar_last_error AS "externalCalendarLastError",
          external_calendar_synced_at AS "externalCalendarSyncedAt"
      `;

      const taskId = String(rows[0].id);
      const nextStatus = String(nextValues.status);
      const shouldCancelSchedules =
        nextStatus === 'completed' ||
        nextStatus === 'cancelled' ||
        nextStatus === 'inactive' ||
        nextStatus === 'draft';
      const existingExternalEventId = typeof cur.external_calendar_event_id === 'string'
        ? cur.external_calendar_event_id
        : null;

      if (shouldCancelSchedules) {
        await enqueueTaskMutationSideEffectBestEffort(
          context,
          user.id,
          taskId,
          'cancel_notification_schedules',
          'handleTaskById:update',
        );
      } else {
        await enqueueTaskMutationSideEffectBestEffort(
          context,
          user.id,
          taskId,
          'sync_notification_schedules',
          'handleTaskById:update',
        );
      }

      if (shouldCancelSchedules && existingExternalEventId) {
        await enqueueTaskMutationSideEffectBestEffort(
          context,
          user.id,
          taskId,
          'delete_external_calendar_event',
          'handleTaskById:update',
        );
      } else if (
        nextStatus === 'pending' &&
        nextValues.dueDate
      ) {
        await enqueueTaskMutationSideEffectBestEffort(
          context,
          user.id,
          taskId,
          'sync_external_calendar',
          'handleTaskById:update',
        );
      }

      void syncTaskTaxonomyBestEffort(context, user.id, taskId, categoryValue, tagsValue);
      const totalMs = Date.now() - totalStartedAt;
      logInfo('tasks:update:total-ms', getRequestMeta(request, { userId: user.id, taskId, durationMs: totalMs }));
      logInfo('task_updated', getRequestMeta(request, { userId: user.id, taskId: id }));
      return json(200, rows[0]);
    } catch (error) {
      logError('task_update_failed', error, getRequestMeta(request, { userId: user.id, taskId: id }));
      return json(500, { error: 'Erro ao atualizar tarefa' });
    }
  }

  if (request.method === 'DELETE') {
    const totalStartedAt = Date.now();
    try {
      const rows = await sql`
        UPDATE tasks
        SET
          status = 'cancelled',
          deleted_at = COALESCE(deleted_at, NOW()),
          external_calendar_sync_status = CASE
            WHEN external_calendar_event_id IS NOT NULL THEN 'pending'
            ELSE external_calendar_sync_status
          END,
          external_calendar_last_error = CASE
            WHEN external_calendar_event_id IS NOT NULL THEN NULL
            ELSE external_calendar_last_error
          END
        WHERE id = ${id}
          AND user_id = ${user.id}
        RETURNING
          id,
          external_calendar_event_id AS "externalCalendarEventId"
      `;
      if (rows[0]) {
        await enqueueTaskMutationSideEffectBestEffort(
          context,
          user.id,
          id,
          'cancel_notification_schedules',
          'handleTaskById:delete',
        );
        if (typeof rows[0].externalCalendarEventId === 'string') {
          await enqueueTaskMutationSideEffectBestEffort(
            context,
            user.id,
            id,
            'delete_external_calendar_event',
            'handleTaskById:delete',
          );
        }
      }
      logInfo('tasks:delete:total-ms', getRequestMeta(request, {
        userId: user.id,
        taskId: id,
        durationMs: Date.now() - totalStartedAt,
      }));
      logInfo('task_deleted', getRequestMeta(request, { userId: user.id, taskId: id }));
      return { status: 204 };
    } catch (error) {
      logError('task_delete_failed', error, getRequestMeta(request, { userId: user.id, taskId: id }));
      return json(500, { error: 'Erro ao deletar tarefa' });
    }
  }

  return methodNotAllowed();
}

export async function handleTaskTaxonomy(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  try {
    const taxonomy = await getTaskTaxonomy(sql, user.id);
    return json(200, taxonomy);
  } catch (error) {
    logError('task_taxonomy_list_failed', error, getRequestMeta(request, { userId: user.id }));
    return json(500, { error: 'Erro ao carregar categorias e tags' });
  }
}

export async function handleTaskHolidays(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  if (request.method !== 'GET') return methodNotAllowed();

  try {
    await ensureHolidayLocationSchema(sql);
    const year = resolveCalendarYear(context);
    const calendar = buildHolidayCalendar({
      stateCode: user.stateCode ?? null,
      cityName: user.cityName ?? null,
      regionCode: user.holidayRegionCode ?? null,
    }, new Date(year, new Date().getMonth(), new Date().getDate()));

    return json(200, calendar);
  } catch (error) {
    logError('task_holidays_failed', error, getRequestMeta(request, { userId: user.id }));
    return json(500, { error: 'Erro ao carregar feriados e datas comemorativas' });
  }
}

export async function handleTaskCalendarExport(context: HandlerContext): Promise<HandlerResult> {
  if (context.request.method !== 'GET') return methodNotAllowed();

  const auth = await requireTaskCalendarAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  try {
    await ensureNotificationSchedulingInfrastructure(sql);
    const rows = await sql`
      SELECT
        id,
        title,
        description,
        due_date    AS "dueDate",
        end_date    AS "endDate",
        priority,
        category,
        tags,
        status,
        created_at  AS "createdAt"
      FROM tasks
      WHERE user_id = ${user.id}
        AND due_date IS NOT NULL
        AND status = 'pending'
        AND deleted_at IS NULL
      ORDER BY due_date ASC
    `;
    const calendar = buildTasksIcs(rows as unknown as CalendarTask[]);

    return {
      status: 200,
      body: calendar,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="lembreto.ics"',
        'Cache-Control': 'private, max-age=300',
      },
    };
  } catch (error) {
    logError('task_calendar_export_failed', error, getRequestMeta(request, { userId: user.id }));
    return json(500, { error: 'Erro ao exportar calendário' });
  }
}

export async function handleTaskCalendarFeed(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;
  if (context.request.method !== 'GET' && context.request.method !== 'POST') return methodNotAllowed();

  const revokedCount = context.request.method === 'POST'
    ? await revokeActiveCalendarFeeds(context.sql, auth.user.id)
    : 0;
  const feed = await createCalendarFeedToken(context.sql, {
    userId: auth.user.id,
    email: auth.user.email,
  });

  return json(200, {
    feedPath: `/api/tasks/calendar.ics?token=${encodeURIComponent(feed.token)}`,
    expiresAt: feed.expiresAt,
    revokedCount,
  });
}

export async function handleTaskHolidayLocationDetect(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const { request } = context;
  if (request.method !== 'POST') return methodNotAllowed();

  const parsed = detectHolidayLocationSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  try {
    const detected = await detectBrazilLocationFromCoordinates(
      parsed.data.latitude,
      parsed.data.longitude,
    );
    return json(200, detected);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Não foi possível identificar sua localização agora.';
    logError('task_holiday_location_detect_failed', error, getRequestMeta(request, { userId: auth.user.id }));
    return json(500, { error: message });
  }
}

export async function handleTaskCategoriesCollection(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  if (request.method === 'DELETE') {
    const name = resolveNameValue(context).trim();
    if (!name) {
      return json(400, { error: 'Categoria inválida' });
    }

    try {
      const deleted = await deleteUserCategory(sql, user.id, name);
      logInfo('task_category_deleted', getRequestMeta(request, { userId: user.id, category: deleted }));
      return json(200, { category: deleted });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao excluir categoria';
      const status = message.includes('padrão') ? 400 : 500;
      if (status === 500) {
        logError('task_category_delete_failed', error, getRequestMeta(request, { userId: user.id, category: name }));
      }
      return json(status, { error: message });
    }
  }

  if (request.method !== 'POST') return methodNotAllowed();

  const parsed = createTaskCategorySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  try {
    await upsertUserCategory(sql, user.id, parsed.data.name);
    logInfo('task_category_created', getRequestMeta(request, { userId: user.id, category: parsed.data.name }));
    return json(201, { category: parsed.data.name.trim() });
  } catch (error) {
    logError('task_category_create_failed', error, getRequestMeta(request, { userId: user.id }));
    return json(500, { error: 'Erro ao criar categoria' });
  }
}

export async function handleTaskTagsCollection(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  if (request.method === 'DELETE') {
    const name = resolveNameValue(context).trim();
    if (!name) {
      return json(400, { error: 'Tag inválida' });
    }

    try {
      const deleted = await deleteUserTag(sql, user.id, name);
      logInfo('task_tag_deleted', getRequestMeta(request, { userId: user.id, tag: deleted }));
      return json(200, { tag: deleted });
    } catch (error) {
      logError('task_tag_delete_failed', error, getRequestMeta(request, { userId: user.id, tag: name }));
      return json(500, { error: 'Erro ao excluir tag' });
    }
  }

  if (request.method !== 'POST') return methodNotAllowed();

  const parsed = createTaskTagSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  const tag = parsed.data.name.trim();

  try {
    await upsertUserTags(sql, user.id, [tag]);
    logInfo('task_tag_created', getRequestMeta(request, { userId: user.id, tag }));
    return json(201, { tag });
  } catch (error) {
    logError('task_tag_create_failed', error, getRequestMeta(request, { userId: user.id }));
    return json(500, { error: 'Erro ao criar tag' });
  }
}
