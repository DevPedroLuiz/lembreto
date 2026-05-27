import { createNoteSchema, createTaskSchema, formatZodError, updateTaskSchema } from '../schemas.js';
import { handleNotesCollection } from '../handlers/notes.js';
import { handleTaskById, handleTasksCollection } from '../handlers/tasks.js';
import type { HandlerContext, HandlerResult } from '../handlers/core.js';
import { ASSISTANT_TIMEZONE } from './gemini.js';
import {
  getAssistantContextRefs,
  saveAssistantActionEvent,
  upsertAssistantContextRef,
  type AssistantActionStatus,
} from './memory.js';
import type { AssistantAction } from './schemas.js';

type TaskListBody = {
  items?: Array<Record<string, unknown>>;
};

export interface AssistantExecutedAction {
  type: string;
  status: AssistantActionStatus;
  entityType?: string;
  entityId?: string;
  entityTitle?: string;
  summary?: string;
}

export interface AssistantExecutionResult {
  message: string;
  action: AssistantExecutedAction;
  references?: {
    lastCreatedTaskId?: string;
    lastUpdatedTaskId?: string;
    listedTaskIds?: string[];
    pendingConfirmationId?: string;
  };
  data?: unknown;
}

interface AssistantToolOptions {
  userId?: string;
  conversationId?: string;
  messageId?: string;
}

class AssistantToolError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function normalizeForSearch(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

function childContext(
  context: HandlerContext,
  input: {
    method: string;
    body?: unknown;
    query?: Record<string, unknown>;
    params?: Record<string, string | undefined>;
  },
): HandlerContext {
  return {
    ...context,
    request: {
      method: input.method,
      headers: context.request.headers,
      body: input.body,
      query: input.query,
      params: input.params,
      ip: context.request.ip,
      requestId: context.request.requestId,
    },
  };
}

function assertSuccessfulResult(result: HandlerResult, fallback: string) {
  if (result.status >= 200 && result.status < 300) return;
  const body = result.body;
  const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
    ? body.error
    : fallback;
  throw new AssistantToolError(message, result.status);
}

function getFortalezaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ASSISTANT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: get('weekday').toLowerCase(),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function fortalezaIso(year: number, month: number, day: number, time: string) {
  const [hour = '09', minute = '00'] = time.split(':');
  const date = new Date(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00-03:00`,
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextMonthlyDueDate(dayOfMonth: number, time = '09:00') {
  const now = new Date();
  const current = getFortalezaDateParts(now);
  let year = current.year;
  let month = current.month;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    const day = Math.min(dayOfMonth, daysInMonth(year, month));
    const candidate = fortalezaIso(year, month, day, time);
    if (candidate && Date.parse(candidate) > now.getTime()) return candidate;

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return null;
}

function nextDailyDueDate(time = '09:00') {
  const now = new Date();
  const current = getFortalezaDateParts(now);
  const today = fortalezaIso(current.year, current.month, current.day, time);
  if (today && Date.parse(today) > now.getTime()) return today;

  const tomorrow = new Date(`${today ?? now.toISOString()}`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const parts = getFortalezaDateParts(tomorrow);
  return fortalezaIso(parts.year, parts.month, parts.day, time);
}

function recurrenceLabel(recurrence: NonNullable<Extract<AssistantAction, { type: 'create_task' }>['payload']['recurrence']>) {
  const interval = recurrence.interval && recurrence.interval > 1 ? ` a cada ${recurrence.interval}` : '';
  const time = recurrence.time ? ` as ${recurrence.time}` : '';
  if (recurrence.type === 'daily') return `diaria${interval}${time}`;
  if (recurrence.type === 'weekly') {
    const days = recurrence.weekdays?.length ? ` (${recurrence.weekdays.join(', ')})` : '';
    return `semanal${interval}${days}${time}`;
  }
  if (recurrence.type === 'monthly') {
    const day = recurrence.dayOfMonth ? `, todo dia ${recurrence.dayOfMonth}` : '';
    return `mensal${interval}${day}${time}`;
  }
  if (recurrence.type === 'yearly') return `anual${interval}${time}`;
  return 'sem repeticao';
}

function resolveDueDateForRecurrence(
  action: Extract<AssistantAction, { type: 'create_task' }>,
): string | null | undefined {
  const dueDate = action.payload.dueDate;
  if (dueDate !== undefined) return dueDate;

  const recurrence = action.payload.recurrence;
  if (!recurrence || recurrence.type === 'none') return dueDate;

  if (recurrence.type === 'monthly' && recurrence.dayOfMonth) {
    return nextMonthlyDueDate(recurrence.dayOfMonth, recurrence.time ?? '09:00');
  }

  if (recurrence.type === 'daily') {
    return nextDailyDueDate(recurrence.time ?? '09:00');
  }

  return null;
}

function withRecurrenceDescription(
  description: string,
  recurrence: Extract<AssistantAction, { type: 'create_task' }>['payload']['recurrence'],
) {
  if (!recurrence || recurrence.type === 'none') return description;

  // TODO: implementar recorrencia real persistida no banco. Por enquanto o assistente cria a proxima ocorrencia.
  const recurrenceText = `Recorrencia solicitada: ${recurrenceLabel(recurrence)}.`;
  return [description.trim(), recurrenceText].filter(Boolean).join('\n\n');
}

function buildTaskSummary(tasks: Array<Record<string, unknown>>) {
  if (tasks.length === 0) return 'Nao encontrei lembretes com esses filtros.';

  const lines = tasks.slice(0, 8).map((task) => {
    const title = String(task.title ?? 'Sem titulo');
    const dueDate = typeof task.dueDate === 'string' && task.dueDate
      ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: ASSISTANT_TIMEZONE,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(task.dueDate))
      : 'sem data';
    return `- ${title} (${dueDate})`;
  });

  const extra = tasks.length > 8 ? `\nE mais ${tasks.length - 8} lembrete(s).` : '';
  return `Encontrei ${tasks.length} lembrete(s):\n${lines.join('\n')}${extra}`;
}

function getEntityId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('id' in value)) return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && isUuid(id) ? id : undefined;
}

function getEntityTitle(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('title' in value)) return undefined;
  const title = (value as { title?: unknown }).title;
  return typeof title === 'string' && title.trim() ? title : undefined;
}

async function getTaskIdentity(
  sql: HandlerContext['sql'],
  userId: string,
  taskId: string,
): Promise<{ id: string; title: string } | null> {
  const rows = await sql`
    SELECT id, title
    FROM tasks
    WHERE id = ${taskId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return {
    id: String(rows[0].id),
    title: String(rows[0].title ?? 'Lembrete'),
  };
}

async function searchTaskIdentities(
  sql: HandlerContext['sql'],
  userId: string,
  search: string,
): Promise<Array<{ id: string; title: string }>> {
  const normalized = search.trim();
  if (!normalized) return [];
  const searchPattern = `%${normalized}%`;
  const rows = await sql`
    SELECT id, title
    FROM tasks
    WHERE user_id = ${userId}
      AND deleted_at IS NULL
      AND status <> 'cancelled'
      AND (
        title ILIKE ${searchPattern}
        OR description ILIKE ${searchPattern}
        OR category ILIKE ${searchPattern}
        OR array_to_string(tags, ' ') ILIKE ${searchPattern}
      )
    ORDER BY created_at DESC
    LIMIT 6
  `;

  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title ?? 'Lembrete'),
  }));
}

function taskOptionsFromMetadata(metadata: unknown): Array<{ id: string; title: string }> {
  if (!metadata || typeof metadata !== 'object' || !('options' in metadata)) return [];
  const options = (metadata as { options?: unknown }).options;
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => {
      if (!option || typeof option !== 'object') return null;
      const id = (option as { id?: unknown }).id;
      const title = (option as { title?: unknown }).title;
      return typeof id === 'string' && isUuid(id) && typeof title === 'string'
        ? { id, title }
        : null;
    })
    .filter((option): option is { id: string; title: string } => Boolean(option));
}

function listedTasksFromMetadata(metadata: unknown): Array<{ id: string; title: string }> {
  if (!metadata || typeof metadata !== 'object' || !('tasks' in metadata)) return [];
  const tasks = (metadata as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks
    .map((task) => {
      if (!task || typeof task !== 'object') return null;
      const id = (task as { id?: unknown }).id;
      const title = (task as { title?: unknown }).title;
      return typeof id === 'string' && isUuid(id) && typeof title === 'string'
        ? { id, title }
        : null;
    })
    .filter((task): task is { id: string; title: string } => Boolean(task));
}

type UpdateTaskPayload = Extract<AssistantAction, { type: 'update_task' }>['payload'];

export async function resolveTaskReference(
  sql: HandlerContext['sql'],
  userId: string,
  conversationId: string,
  payload: UpdateTaskPayload,
): Promise<
  | { status: 'resolved'; task: { id: string; title: string } }
  | { status: 'not_found'; message: string }
  | { status: 'ambiguous'; message: string; options: Array<{ id: string; title: string }> }
> {
  if (payload.taskId) {
    const task = await getTaskIdentity(sql, userId, payload.taskId);
    if (!task) return { status: 'not_found', message: 'Nao encontrei esse lembrete na sua conta.' };
    return { status: 'resolved', task };
  }

  const refs = await getAssistantContextRefs(sql, conversationId, 10, userId);
  const latestRef = (key: string) => refs.find((ref) => ref.refKey === key);

  if (payload.contextRef) {
    const refKeyMap: Record<NonNullable<UpdateTaskPayload['contextRef']>, string> = {
      last_created_task: 'last_created_task',
      last_updated_task: 'last_updated_task',
      last_relevant_task: 'last_relevant_task',
      last_listed_task_first: 'last_listed_tasks',
      last_listed_task_last: 'last_listed_tasks',
    };
    const ref = latestRef(refKeyMap[payload.contextRef]);

    if (payload.contextRef === 'last_listed_task_first' || payload.contextRef === 'last_listed_task_last') {
      const tasks = ref ? listedTasksFromMetadata(ref.metadata) : [];
      const selected = payload.contextRef === 'last_listed_task_first' ? tasks[0] : tasks[tasks.length - 1];
      if (!selected) return { status: 'not_found', message: 'Nao encontrei uma lista recente de lembretes para usar como referencia.' };
      const task = await getTaskIdentity(sql, userId, selected.id);
      if (!task) return { status: 'not_found', message: 'Esse lembrete nao esta mais disponivel.' };
      return { status: 'resolved', task };
    }

    if (ref?.entityId) {
      const task = await getTaskIdentity(sql, userId, ref.entityId);
      if (!task) return { status: 'not_found', message: 'Esse lembrete nao esta mais disponivel.' };
      return { status: 'resolved', task };
    }

    return { status: 'not_found', message: 'Nao encontrei um lembrete recente para usar como referencia.' };
  }

  if (payload.search) {
    const pendingConfirmation = latestRef('pending_confirmation');
    const pendingOptions = taskOptionsFromMetadata(pendingConfirmation?.metadata);
    if (pendingOptions.length > 0) {
      const normalizedSearch = normalizeForSearch(payload.search);
      const matchingOptions = pendingOptions.filter((option) => normalizeForSearch(option.title).includes(normalizedSearch));
      if (matchingOptions.length === 1) {
        const task = await getTaskIdentity(sql, userId, matchingOptions[0].id);
        if (task) return { status: 'resolved', task };
      }
    }

    const matches = await searchTaskIdentities(sql, userId, payload.search);
    if (matches.length === 0) {
      return { status: 'not_found', message: 'Nao encontrei um lembrete correspondente para atualizar.' };
    }
    if (matches.length > 1) {
      return {
        status: 'ambiguous',
        message: `Encontrei mais de um lembrete possivel. Voce quer alterar ${matches.slice(0, 5).map((task) => `"${task.title}"`).join(' ou ')}?`,
        options: matches.slice(0, 5),
      };
    }
    return { status: 'resolved', task: matches[0] };
  }

  return { status: 'not_found', message: 'Qual lembrete voce quer atualizar?' };
}

async function listTasks(
  context: HandlerContext,
  payload: Extract<AssistantAction, { type: 'list_tasks' }>['payload'],
) {
  const result = await handleTasksCollection(childContext(context, {
    method: 'GET',
    query: {
      page: '1',
      limit: '20',
      sort: 'dueDate',
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.search ? { search: payload.search } : {}),
      ...(payload.from ? { dueStart: payload.from } : {}),
      ...(payload.to ? { dueEnd: payload.to } : {}),
    },
  }));
  assertSuccessfulResult(result, 'Nao consegui consultar seus lembretes agora.');
  return result.body as TaskListBody;
}

async function executeCreateTask(
  context: HandlerContext,
  action: Extract<AssistantAction, { type: 'create_task' }>,
): Promise<AssistantExecutionResult> {
  const dueDate = resolveDueDateForRecurrence(action);
  const recurrence = action.payload.recurrence;
  if (recurrence && recurrence.type !== 'none' && !dueDate) {
    return {
      message: 'Consigo criar essa repeticao, mas preciso de uma data ou regra mais especifica para a primeira ocorrencia.',
      action: { type: 'needs_confirmation', status: 'needs_confirmation' },
    };
  }

  const payload = {
    title: action.payload.title,
    description: withRecurrenceDescription(action.payload.description ?? '', recurrence),
    dueDate: dueDate ?? null,
    endDate: action.payload.endDate ?? null,
    priority: action.payload.priority ?? 'medium',
    category: action.payload.category ?? 'Geral',
    tags: action.payload.tags ?? [],
    alarmEnabled: dueDate ? action.payload.alarmEnabled ?? true : false,
    noTimeReminderMinutes: action.payload.noTimeReminderMinutes,
    status: 'pending' as const,
  };

  const parsed = createTaskSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AssistantToolError(formatZodError(parsed.error), 400);
  }

  const result = await handleTasksCollection(childContext(context, {
    method: 'POST',
    body: parsed.data,
  }));
  assertSuccessfulResult(result, 'Nao consegui criar o lembrete agora.');

  return {
    message: action.confirmationMessage,
    action: {
      type: action.type,
      status: 'success',
      entityType: 'task',
      entityId: getEntityId(result.body),
      entityTitle: getEntityTitle(result.body),
      summary: action.confirmationMessage,
    },
    data: result.body,
  };
}

async function executeUpdateTask(
  context: HandlerContext,
  action: Extract<AssistantAction, { type: 'update_task' }>,
  options?: AssistantToolOptions,
): Promise<AssistantExecutionResult> {
  let taskId = action.payload.taskId;
  let taskTitle: string | undefined;

  if (options?.userId && options.conversationId) {
    const resolved = await resolveTaskReference(context.sql, options.userId, options.conversationId, action.payload);
    if (resolved.status === 'not_found') {
      return {
        message: resolved.message,
        action: { type: 'needs_confirmation', status: 'needs_confirmation' },
      };
    }
    if (resolved.status === 'ambiguous') {
      return {
        message: resolved.message,
        action: { type: 'needs_confirmation', status: 'needs_confirmation' },
        data: { options: resolved.options, draftAction: action },
      };
    }

    taskId = resolved.task.id;
    taskTitle = resolved.task.title;
  } else if (!taskId) {
    const listed = await listTasks(context, {
      search: action.payload.search,
      status: action.payload.updates.status === 'completed' ? 'pending' : undefined,
    });
    const matches = Array.isArray(listed.items) ? listed.items : [];
    if (matches.length === 0) {
      return {
        message: 'Nao encontrei um lembrete correspondente para atualizar.',
        action: { type: 'needs_confirmation', status: 'needs_confirmation' },
      };
    }
    if (matches.length > 1) {
      return {
        message: `Encontrei mais de um lembrete. Qual deles voce quer atualizar?\n${buildTaskSummary(matches.slice(0, 5))}`,
        action: { type: 'needs_confirmation', status: 'needs_confirmation' },
        data: { matches: matches.slice(0, 5) },
      };
    }
    taskId = String(matches[0].id);
    taskTitle = getEntityTitle(matches[0]);
  }

  const parsed = updateTaskSchema.safeParse(action.payload.updates);
  if (!parsed.success) {
    throw new AssistantToolError(formatZodError(parsed.error), 400);
  }

  const result = await handleTaskById(childContext(context, {
    method: 'PUT',
    params: { id: taskId },
    body: parsed.data,
  }));
  assertSuccessfulResult(result, 'Nao consegui atualizar o lembrete agora.');

  return {
    message: action.confirmationMessage,
    action: {
      type: action.type,
      status: 'success',
      entityType: 'task',
      entityId: getEntityId(result.body) ?? taskId,
      entityTitle: getEntityTitle(result.body) ?? taskTitle,
      summary: action.confirmationMessage,
    },
    data: result.body,
  };
}

async function executeCreateNote(
  context: HandlerContext,
  action: Extract<AssistantAction, { type: 'create_note' }>,
): Promise<AssistantExecutionResult> {
  const payload = {
    title: action.payload.title,
    content: action.payload.content,
    priority: 'medium' as const,
    category: action.payload.category ?? 'Geral',
    tags: action.payload.tags ?? [],
    mode: 'fixed' as const,
    expiresAt: null,
    taskId: null,
  };

  const parsed = createNoteSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AssistantToolError(formatZodError(parsed.error), 400);
  }

  const result = await handleNotesCollection(childContext(context, {
    method: 'POST',
    body: parsed.data,
  }));
  assertSuccessfulResult(result, 'Nao consegui criar a nota agora.');

  return {
    message: action.confirmationMessage,
    action: {
      type: action.type,
      status: 'success',
      entityType: 'note',
      entityId: getEntityId(result.body),
      entityTitle: getEntityTitle(result.body),
      summary: action.confirmationMessage,
    },
    data: result.body,
  };
}

async function buildReferences(context: HandlerContext, options?: AssistantToolOptions): Promise<AssistantExecutionResult['references']> {
  if (!options?.conversationId || !options.userId) return undefined;
  const refs = await getAssistantContextRefs(context.sql, options.conversationId, 10, options.userId);
  const find = (key: string) => refs.find((ref) => ref.refKey === key);
  const listedTasks = listedTasksFromMetadata(find('last_listed_tasks')?.metadata);
  return {
    lastCreatedTaskId: find('last_created_task')?.entityId ?? undefined,
    lastUpdatedTaskId: find('last_updated_task')?.entityId ?? undefined,
    listedTaskIds: listedTasks.length > 0 ? listedTasks.map((task) => task.id) : undefined,
    pendingConfirmationId: find('pending_confirmation')?.id,
  };
}

async function persistExecutionOutcome(
  context: HandlerContext,
  result: AssistantExecutionResult,
  rawAction: AssistantAction,
  options?: AssistantToolOptions,
): Promise<AssistantExecutionResult> {
  if (!options?.userId || !options.conversationId) return result;

  await saveAssistantActionEvent(context.sql, {
    conversationId: options.conversationId,
    userId: options.userId,
    messageId: options.messageId,
    actionType: result.action.type,
    status: result.action.status,
    entityType: result.action.entityType ?? null,
    entityId: result.action.entityId ?? null,
    entityTitle: result.action.entityTitle ?? null,
    summary: result.action.summary ?? result.message,
    payload: {
      action: rawAction,
      result: result.data ?? null,
    },
  });

  if (result.action.status === 'success' && result.action.entityType === 'task' && result.action.entityId) {
    if (result.action.type === 'create_task') {
      await upsertAssistantContextRef(context.sql, {
        conversationId: options.conversationId,
        userId: options.userId,
        refKey: 'last_created_task',
        entityType: 'task',
        entityId: result.action.entityId,
        entityTitle: result.action.entityTitle ?? null,
        metadata: {},
      });
    }
    if (result.action.type === 'update_task') {
      await upsertAssistantContextRef(context.sql, {
        conversationId: options.conversationId,
        userId: options.userId,
        refKey: 'last_updated_task',
        entityType: 'task',
        entityId: result.action.entityId,
        entityTitle: result.action.entityTitle ?? null,
        metadata: {},
      });
    }
    await upsertAssistantContextRef(context.sql, {
      conversationId: options.conversationId,
      userId: options.userId,
      refKey: 'last_relevant_task',
      entityType: 'task',
      entityId: result.action.entityId,
      entityTitle: result.action.entityTitle ?? null,
      metadata: {},
    });
  }

  if (result.action.type === 'list_tasks' && result.action.status === 'success') {
    const taskItems = result.data && typeof result.data === 'object' && Array.isArray((result.data as TaskListBody).items)
      ? (result.data as TaskListBody).items ?? []
      : [];
    const tasks = taskItems
      .map((task) => {
        const id = getEntityId(task);
        const title = getEntityTitle(task);
        return id && title ? { id, title } : null;
      })
      .filter((task): task is { id: string; title: string } => Boolean(task));

    await upsertAssistantContextRef(context.sql, {
      conversationId: options.conversationId,
      userId: options.userId,
      refKey: 'last_listed_tasks',
      entityType: 'task_list',
      metadata: { tasks },
    });

    if (tasks.length === 1) {
      await upsertAssistantContextRef(context.sql, {
        conversationId: options.conversationId,
        userId: options.userId,
        refKey: 'last_relevant_task',
        entityType: 'task',
        entityId: tasks[0].id,
        entityTitle: tasks[0].title,
        metadata: {},
      });
    }
  }

  if (result.action.status === 'success' && result.action.entityType === 'note' && result.action.entityId) {
    await upsertAssistantContextRef(context.sql, {
      conversationId: options.conversationId,
      userId: options.userId,
      refKey: 'last_created_note',
      entityType: 'note',
      entityId: result.action.entityId,
      entityTitle: result.action.entityTitle ?? null,
      metadata: {},
    });
  }

  if (result.action.status === 'needs_confirmation') {
    const confirmationRef = await upsertAssistantContextRef(context.sql, {
      conversationId: options.conversationId,
      userId: options.userId,
      refKey: 'pending_confirmation',
      entityType: 'confirmation',
      entityTitle: 'Confirmacao pendente',
      metadata: {
        question: result.message,
        draftAction: rawAction,
        options: result.data && typeof result.data === 'object' && Array.isArray((result.data as { options?: unknown }).options)
          ? (result.data as { options: unknown }).options
          : [],
      },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    result.references = {
      ...(result.references ?? {}),
      pendingConfirmationId: confirmationRef.id,
    };
  }

  result.references = {
    ...(await buildReferences(context, options)),
    ...(result.references ?? {}),
  };

  return result;
}

export async function executeAssistantAction(
  context: HandlerContext,
  action: AssistantAction,
  options?: AssistantToolOptions,
): Promise<AssistantExecutionResult> {
  try {
    let result: AssistantExecutionResult;
    if (action.type === 'create_task') {
      result = await executeCreateTask(context, action);
      return persistExecutionOutcome(context, result, action, options);
    }
    if (action.type === 'list_tasks') {
      const result = await listTasks(context, action.payload);
      const tasks = Array.isArray(result.items) ? result.items : [];
      return persistExecutionOutcome(context, {
        message: tasks.length > 0 ? buildTaskSummary(tasks) : action.confirmationMessage,
        action: {
          type: action.type,
          status: 'success',
          summary: tasks.length > 0 ? `Consulta retornou ${tasks.length} lembrete(s).` : 'Consulta sem lembretes encontrados.',
        },
        data: result,
      }, action, options);
    }
    if (action.type === 'update_task') {
      result = await executeUpdateTask(context, action, options);
      return persistExecutionOutcome(context, result, action, options);
    }
    if (action.type === 'create_note') {
      result = await executeCreateNote(context, action);
      return persistExecutionOutcome(context, result, action, options);
    }
    if (action.type === 'answer_only') {
      return persistExecutionOutcome(context, {
        message: action.payload.answer,
        action: { type: action.type, status: 'skipped', summary: action.payload.answer },
      }, action, options);
    }
    if (action.type === 'needs_confirmation') {
      return persistExecutionOutcome(context, {
        message: action.payload.question,
        action: { type: action.type, status: 'needs_confirmation', summary: action.payload.question },
        data: action.payload.draftAction,
      }, action, options);
    }

    return persistExecutionOutcome(context, {
      message: 'Ainda nao sei executar esse tipo de pedido.',
      action: { type: 'needs_confirmation', status: 'needs_confirmation' },
    }, action, options);
  } catch (error) {
    if (error instanceof AssistantToolError) {
      return persistExecutionOutcome(context, {
        message: error.message,
        action: { type: action.type, status: 'failed', summary: error.message },
        data: { status: error.status },
      }, action, options);
    }

    throw error;
  }
}
