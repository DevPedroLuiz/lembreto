import { getAuthFailureResponse, getSafeUserById, requireAuthFromAuthorizationHeader } from '../auth.js';
import { randomUUID } from 'node:crypto';
import { buildTasksIcs, type CalendarTask } from '../calendar/ics.js';
import {
  ensureCalendarIntegrationSchema,
} from '../calendar/calendarSync.js';
import {
  buildHolidayCalendar,
  detectBrazilLocationFromCoordinates,
  ensureHolidayLocationSchema,
} from '../holidays.js';
import { logError, logInfo } from '../logger.js';
import {
  cancelPendingNotificationSchedulesForTask,
  ensureNotificationSchedulingInfrastructure,
  syncTaskNotificationSchedulesLightweight,
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
import { signCalendarFeedToken, verifyCalendarFeedToken } from '../jwt.js';
import {
  type HandlerContext,
  type HandlerResult,
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

const PRIORITY_HISTORY_LABELS: Record<string, string> = {
  low: 'baixa',
  medium: 'media',
  high: 'alta',
};
const WORK_TIME_REQUIRED_MESSAGE = 'Horário inicial e horário final são obrigatórios para categoria Trabalho.';
const WORK_END_AFTER_START_MESSAGE = 'Horário final precisa ser depois do horário inicial.';

let taskInfrastructureReady: Promise<void> | null = null;

async function ensureTaskInfrastructure(sql: HandlerContext['sql']) {
  taskInfrastructureReady ??= (async () => {
    await ensureTaskTaxonomySchema(sql);
    await ensureCalendarIntegrationSchema(sql);
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

async function requireTaskCalendarAuth(context: HandlerContext) {
  const feedToken = getQueryStringValue(context, 'token');

  if (feedToken) {
    try {
      const payload = verifyCalendarFeedToken(feedToken);
      const user = await getSafeUserById(context.sql, payload.sub);
      if (!user) return json(401, { error: 'UsuÃ¡rio nÃ£o encontrado' });
      return { payload, user, token: feedToken };
    } catch (error) {
      logError('task_calendar_feed_auth_failed', error, getRequestMeta(context.request));
      return json(401, { error: 'Link de calendÃ¡rio invÃ¡lido' });
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

async function syncTaskNotificationSchedulesBestEffort(
  context: HandlerContext,
  userId: string,
  taskId: string,
  options?: { floatingIntervalMinutes: number | null },
) {
  try {
    await syncTaskNotificationSchedulesLightweight(context.sql, userId, taskId, {
      ...options,
      ensureInfrastructure: false,
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string' &&
      error.message.includes('notification_schedules_user_id_fkey')
    ) {
      return;
    }

    logError('task_notification_schedule_sync_failed', error, getRequestMeta(context.request, { userId, taskId }));
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
    changedDetails.push('ConfiguraÃ§Ã£o de alarme alterada.');
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
      const rows = await sql`
        SELECT
          id,
          user_id     AS "userId",
          title,
          description,
          due_date    AS "dueDate",
          end_date    AS "endDate",
          priority,
          category,
          tags,
          suppress_holiday_notifications AS "suppressHolidayNotifications",
          alarm_enabled AS "alarmEnabled",
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
          AND status <> 'cancelled'
        ORDER BY created_at DESC
      `;
      return json(200, rows);
    } catch (error) {
      logError('tasks_list_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao buscar tarefas' });
    }
  }

  if (request.method === 'POST') {
    const parsed = createTaskSchema.safeParse(request.body ?? {});
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
      suppressHolidayNotifications,
      alarmEnabled,
      mutedUntil,
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
        status,
      }),
    ]);

    try {
      const rows = await sql`
        INSERT INTO tasks (
          user_id,
          title,
          description,
          due_date,
          end_date,
          priority,
          category,
          tags,
          suppress_holiday_notifications,
          alarm_enabled,
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
          ${title},
          ${description},
          ${effectiveDueDate},
          ${effectiveEndDate},
          ${priority},
          ${category},
          ${tags},
          ${suppressHolidayNotifications},
          ${effectiveAlarmEnabled},
          ${effectiveDueDate ? 'timed' : 'floating'},
          ${effectiveDueDate ? null : new Date(Date.now() + 24 * 60 * 60 * 1000)},
          ${mutedUntil || null},
          ${effectiveDueDate ? null : noTimeReminderMinutes ?? 60},
          ${status},
          ${effectiveDueDate && status === 'pending' ? 'pending' : 'idle'},
          ${history}::jsonb
        )
        RETURNING
          id,
          user_id     AS "userId",
          title,
          description,
          due_date    AS "dueDate",
          end_date    AS "endDate",
          priority,
          category,
          tags,
          suppress_holiday_notifications AS "suppressHolidayNotifications",
          alarm_enabled AS "alarmEnabled",
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

      void syncTaskTaxonomyBestEffort(context, user.id, String(rows[0].id), category, tags);
      await syncTaskNotificationSchedulesBestEffort(context, user.id, String(rows[0].id), {
        floatingIntervalMinutes: noTimeReminderMinutes ?? null,
      });
      logInfo('task_created', getRequestMeta(request, { userId: user.id }));
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
        mutedUntil,
        noTimeReminderMinutes,
      } = parsed.data;
      const nextTags = parsed.data.tags ? sanitizeTaskTags(parsed.data.tags) : undefined;

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
          suppress_holiday_notifications,
          muted_until,
          floating_interval_minutes,
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
        mutedUntil: mutedUntil !== undefined ? mutedUntil || null : cur.muted_until,
        floatingIntervalMinutes: noTimeReminderMinutes !== undefined
          ? noTimeReminderMinutes
          : cur.floating_interval_minutes,
        status: status !== undefined ? status : cur.status,
      };
      if (!nextValues.dueDate) {
        nextValues.endDate = null;
        nextValues.alarmEnabled = false;
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
          alarm_enabled = ${nextValues.alarmEnabled},
          reminder_mode = ${nextValues.dueDate ? 'timed' : 'floating'},
          expires_at = CASE
            WHEN ${nextValues.dueDate}::timestamptz IS NULL THEN COALESCE(expires_at, NOW() + INTERVAL '24 hours')
            ELSE NULL
          END,
          overdue_since = CASE WHEN ${nextValues.dueDate}::timestamptz IS NULL THEN NULL ELSE overdue_since END,
          overdue_expires_at = CASE WHEN ${nextValues.dueDate}::timestamptz IS NULL THEN NULL ELSE overdue_expires_at END,
          muted_until = ${nextValues.mutedUntil},
          floating_interval_minutes = ${nextValues.dueDate ? null : nextValues.floatingIntervalMinutes ?? 60},
          status      = ${nextValues.status},
          completed_at = CASE
            WHEN ${nextValues.status} = 'completed' THEN COALESCE(completed_at, NOW())
            WHEN ${nextValues.status} IN ('pending', 'overdue') THEN NULL
            ELSE completed_at
          END,
          completion_source = CASE
            WHEN ${nextValues.status} = 'completed' THEN COALESCE(completion_source, 'user')
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
          title,
          description,
          due_date    AS "dueDate",
          end_date    AS "endDate",
          priority,
          category,
          tags,
          suppress_holiday_notifications AS "suppressHolidayNotifications",
          alarm_enabled AS "alarmEnabled",
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

      void syncTaskTaxonomyBestEffort(context, user.id, String(rows[0].id), categoryValue, tagsValue);
      if (
        String(nextValues.status) === 'completed' ||
        String(nextValues.status) === 'cancelled' ||
        String(nextValues.status) === 'inactive' ||
        String(nextValues.status) === 'draft'
      ) {
        void cancelPendingNotificationSchedulesForTask(sql, String(rows[0].id), user.id, { ensureInfrastructure: false })
          .catch((error) => logError('task_schedule_cancel_failed', error, { userId: user.id, taskId: String(rows[0].id) }));
      } else {
        await syncTaskNotificationSchedulesBestEffort(context, user.id, String(rows[0].id), {
          floatingIntervalMinutes: noTimeReminderMinutes ?? null,
        });
      }
      logInfo('task_updated', getRequestMeta(request, { userId: user.id, taskId: id }));
      return json(200, rows[0]);
    } catch (error) {
      logError('task_update_failed', error, getRequestMeta(request, { userId: user.id, taskId: id }));
      return json(500, { error: 'Erro ao atualizar tarefa' });
    }
  }

  if (request.method === 'DELETE') {
    try {
      await sql`
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
      `;
      void cancelPendingNotificationSchedulesForTask(sql, id, user.id, { ensureInfrastructure: false })
        .catch((error) => logError('task_schedule_cancel_failed', error, { userId: user.id, taskId: id }));
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
    return json(500, { error: 'Erro ao exportar calendÃ¡rio' });
  }
}

export async function handleTaskCalendarFeed(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;
  if (context.request.method !== 'GET') return methodNotAllowed();

  const token = signCalendarFeedToken({
    sub: auth.user.id,
    email: auth.user.email,
  });

  return json(200, {
    feedPath: `/api/tasks/calendar.ics?token=${encodeURIComponent(token)}`,
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
