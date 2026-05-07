import { getAuthFailureResponse, getSafeUserById, requireAuthFromAuthorizationHeader } from '../auth.js';
import { randomUUID } from 'node:crypto';
import { buildTasksIcs, type CalendarTask } from '../calendar/ics.js';
import {
  ensureCalendarIntegrationSchema,
  getTaskForCalendarSync,
  removeTaskFromExternalCalendar,
  syncTaskToExternalCalendar,
} from '../calendar/calendarSync.js';
import {
  buildHolidayCalendar,
  detectBrazilLocationFromCoordinates,
  ensureHolidayLocationSchema,
} from '../holidays.js';
import { logError, logInfo } from '../logger.js';
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

async function syncTaskCalendarBestEffort(
  context: HandlerContext,
  userId: string,
  taskId: string,
): Promise<void> {
  try {
    await syncTaskToExternalCalendar({
      sql: context.sql,
      userId,
      taskId,
    });
  } catch (error) {
    logError('task_calendar_sync_unhandled_failed', error, getRequestMeta(context.request, { userId, taskId }));
  }
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
}): TaskHistoryEntry {
  const details = [
    input.dueDate ? 'Prazo inicial definido.' : 'Criado sem prazo definido.',
    `Prioridade inicial: ${PRIORITY_HISTORY_LABELS[input.priority] ?? input.priority}.`,
    `Categoria inicial: ${input.category}.`,
  ];

  if (input.tags.length > 0) {
    details.push(`Tags iniciais: ${input.tags.join(', ')}.`);
  }

  if (input.endDate) {
    details.push('Horário final definido.');
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

  await ensureTaskTaxonomySchema(sql);
  await ensureCalendarIntegrationSchema(sql);

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
      suppressHolidayNotifications,
    } = parsed.data;
    const tags = sanitizeTaskTags(parsed.data.tags);
    const history = JSON.stringify([
      buildCreatedHistoryEntry({
        dueDate,
        endDate,
        priority,
        category,
        tags,
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
          history
        )
        VALUES (
          ${user.id},
          ${title},
          ${description},
          ${dueDate || null},
          ${endDate || null},
          ${priority},
          ${category},
          ${tags},
          ${suppressHolidayNotifications},
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
          status,
          history,
          created_at  AS "createdAt",
          external_calendar_provider AS "externalCalendarProvider",
          external_calendar_event_id AS "externalCalendarEventId",
          external_calendar_sync_status AS "externalCalendarSyncStatus",
          external_calendar_last_error AS "externalCalendarLastError",
          external_calendar_synced_at AS "externalCalendarSyncedAt"
      `;

      await syncTaskTaxonomy(sql, user.id, category, tags);
      await syncTaskCalendarBestEffort(context, user.id, String(rows[0].id));
      logInfo('task_created', getRequestMeta(request, { userId: user.id }));
      const syncedRows = await sql`
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
          status,
          history,
          created_at  AS "createdAt",
          external_calendar_provider AS "externalCalendarProvider",
          external_calendar_event_id AS "externalCalendarEventId",
          external_calendar_sync_status AS "externalCalendarSyncStatus",
          external_calendar_last_error AS "externalCalendarLastError",
          external_calendar_synced_at AS "externalCalendarSyncedAt"
        FROM tasks
        WHERE id = ${rows[0].id} AND user_id = ${user.id}
      `;
      return json(201, syncedRows[0] ?? rows[0]);
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

  await ensureTaskTaxonomySchema(sql);
  await ensureCalendarIntegrationSchema(sql);

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
        suppressHolidayNotifications,
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
          suppress_holiday_notifications,
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
        status: status !== undefined ? status : cur.status,
      };
      const shouldValidateEndDateRequirement = category !== undefined || endDate !== undefined;
      if (
        shouldValidateEndDateRequirement &&
        String(nextValues.category).trim().toLocaleLowerCase('pt-BR') === 'trabalho' &&
        !nextValues.endDate
      ) {
        return json(400, { error: 'Horário final obrigatório para categoria Trabalho' });
      }
      if (
        nextValues.dueDate &&
        nextValues.endDate &&
        Date.parse(String(nextValues.endDate)) <= Date.parse(String(nextValues.dueDate))
      ) {
        return json(400, { error: 'Horário final precisa ser depois do horário inicial' });
      }
      const historyEntry = buildUpdateHistoryEntry(cur, nextValues);
      const historyUpdate = historyEntry ? JSON.stringify([historyEntry]) : null;

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
          status      = ${nextValues.status},
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
          status,
          history,
          created_at  AS "createdAt",
          external_calendar_provider AS "externalCalendarProvider",
          external_calendar_event_id AS "externalCalendarEventId",
          external_calendar_sync_status AS "externalCalendarSyncStatus",
          external_calendar_last_error AS "externalCalendarLastError",
          external_calendar_synced_at AS "externalCalendarSyncedAt"
      `;

      await syncTaskTaxonomy(sql, user.id, categoryValue, tagsValue);
      await syncTaskCalendarBestEffort(context, user.id, String(rows[0].id));
      logInfo('task_updated', getRequestMeta(request, { userId: user.id, taskId: id }));
      const syncedRows = await sql`
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
          status,
          history,
          created_at  AS "createdAt",
          external_calendar_provider AS "externalCalendarProvider",
          external_calendar_event_id AS "externalCalendarEventId",
          external_calendar_sync_status AS "externalCalendarSyncStatus",
          external_calendar_last_error AS "externalCalendarLastError",
          external_calendar_synced_at AS "externalCalendarSyncedAt"
        FROM tasks
        WHERE id = ${rows[0].id} AND user_id = ${user.id}
      `;
      return json(200, syncedRows[0] ?? rows[0]);
    } catch (error) {
      logError('task_update_failed', error, getRequestMeta(request, { userId: user.id, taskId: id }));
      return json(500, { error: 'Erro ao atualizar tarefa' });
    }
  }

  if (request.method === 'DELETE') {
    try {
      const taskForCalendar = await getTaskForCalendarSync(sql, user.id, id);
      if (taskForCalendar) {
        await removeTaskFromExternalCalendar({
          sql,
          userId: user.id,
          task: taskForCalendar,
        });
      }
      await sql`DELETE FROM tasks WHERE id = ${id} AND user_id = ${user.id}`;
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
