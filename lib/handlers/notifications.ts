import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../auth.js';
import { getDatabaseConnectionMetadata } from '../db.js';
import { logError, logInfo, logWarn } from '../logger.js';
import {
  clearNotificationsForUser,
  createNotification,
  deletePushSubscription,
  getNotificationsEnabled,
  getPushPublicKey,
  isPushConfigured,
  listNotificationsForUser,
  NotificationCursorError,
  type ListNotificationsOptions,
  type NotificationListFilters,
  markAllNotificationsRead,
  markNotificationReadState,
  NotificationReferenceUnavailableError,
  retryTemporaryPushDeliveries,
  setNotificationsEnabled,
  upsertPushSubscription,
} from '../notifications.js';
import {
  getNotificationPreferences,
  setNotificationPreferences,
} from '../notification-preferences.js';
import { requireCurrentOrganization } from '../organizations.js';
import {
  backfillMissingNotificationSchedules,
  cancelPendingNotificationSchedulesForUser,
  detectOverdueNotificationSchedules,
  dismissAlarmSchedule,
  getScheduleDiagnostics,
  listNotificationSchedulesForUser,
  processDueNotificationSchedules,
  type ProcessNotificationSchedulesSummary,
  type ScheduleDiagnostics,
  snoozeAlarmSchedule,
} from '../notification-schedules.js';
import {
  processExternalCalendarSideEffects,
  processTaskSideEffects,
  type ProcessTaskSideEffectsSummary,
  type SideEffectDiagnostics,
  type TaskSideEffectKind,
} from '../task-side-effects.js';
import {
  createNotificationSchema,
  deletePushSubscriptionSchema,
  formatZodError,
  pushSubscriptionSchema,
  updateNotificationSchema,
  updateNotificationSettingsSchema,
  snoozeAlarmSchema,
} from '../schemas.js';
import {
  NOTIFICATION_SCHEDULE_KINDS,
  NOTIFICATION_SCHEDULE_STATUSES,
  NOTIFICATION_TONES,
  type NotificationScheduleStatus,
  type NotificationScheduleKind,
  type NotificationTone,
} from '../contracts.js';
import {
  empty,
  type HandlerContext,
  type HandlerResult,
  getRequestMeta,
  json,
  methodNotAllowed,
} from './core.js';

const SIDE_EFFECT_PROCESS_DURATION_MS = 8000;
const CALENDAR_SYNC_DURATION_MS = 10000;
const MAX_CRON_RESPONSE_MS = 20000;
const DUE_SCHEDULE_LIMIT = 5;
const DUE_SCHEDULE_DURATION_MS = 8000;
const DUE_SCHEDULE_RECLAIM_LIMIT = 2;
const SIDE_EFFECT_LIMIT = 3;
const BACKFILL_LIMIT = 3;
const BACKFILL_DURATION_MS = 3000;
const CALENDAR_SYNC_LIMIT = 1;
const OVERDUE_LIMIT = 3;
const OVERDUE_DURATION_MS = 3000;
const CRON_DEADLINE_GUARD_MS = 500;
const DEFAULT_DB_HEALTH_QUERY_TIMEOUT_MS = 3000;
const DB_HEALTH_SLOW_THRESHOLD_MS = 1000;
const USER_DUE_SCHEDULE_LIMIT = 5;
const USER_DUE_SCHEDULE_DURATION_MS = 3500;
const USER_NOTIFICATION_SIDE_EFFECT_LIMIT = 3;
const USER_NOTIFICATION_SIDE_EFFECT_DURATION_MS = 2500;
const DEFAULT_SCHEDULE_BACKLOG_ALERT_THRESHOLD = 10;

type BackfillSummary = Awaited<ReturnType<typeof backfillMissingNotificationSchedules>> & {
  stoppedByTimeLimit?: boolean;
};
type CalendarSyncSummary = Awaited<ReturnType<typeof processExternalCalendarSideEffects>>;
type OverdueDetectionSummary = Awaited<ReturnType<typeof detectOverdueNotificationSchedules>> & {
  stoppedByTimeLimit?: boolean;
};
type MeasuredQueryStep = {
  ok: boolean;
  durationMs: number;
  error?: string;
  skipped?: boolean;
};

type CronDbHealth = {
  ok: boolean;
  slow: boolean;
  connection: ReturnType<typeof getDatabaseConnectionMetadata>;
  db: {
    nowMs: number | null;
    taskSideEffectsPendingMs: number | null;
    taskSideEffectsDueMs: number | null;
    taskSideEffectsNotificationDueMs: number | null;
    taskSideEffectsDueByKindMs: number | null;
    schedulesPendingMs: number | null;
    schedulesDueMs: number | null;
    schedulesProcessingMs: number | null;
    missingScheduleCandidatesMs: number | null;
    tasksPendingMs: number | null;
    overdueCandidatesMs: number | null;
  };
  counts: {
    taskSideEffectsPending: number | null;
    taskSideEffectsDue: number | null;
    taskSideEffectsNotificationDue: number | null;
    taskSideEffectsDueByKind: SideEffectKindCounts;
    schedulesPending: number | null;
    schedulesDue: number | null;
    schedulesDueByKind: ScheduleKindCounts;
    schedulesProcessing: number | null;
    schedulesStuckProcessing: number | null;
    missingScheduleCandidates: number | null;
    tasksPending: number | null;
    overdueCandidates: number | null;
  };
  steps: Record<string, MeasuredQueryStep>;
};

type LockDiagnostics = {
  ok: boolean;
  durationMs: number;
  longRunningActive: number | null;
  waitingOnLock: number | null;
  waitingLocksOnReminderTables: number | null;
  grantedLocksOnReminderTables: number | null;
  error?: string;
};

type ScheduleKindCounts = Record<NotificationScheduleKind, number>;
type SideEffectKindCounts = Record<string, number>;

type CronBacklogWarning = {
  message: string;
  kind: 'has_more' | 'schedule_backlog' | 'side_effect_backlog' | 'backfill_backlog' | 'calendar_backlog' | 'overdue_backlog';
  dueCount?: number;
  processedCount?: number;
  limit?: number;
  remainingEstimate?: number;
};

const EMPTY_SCHEDULE_DIAGNOSTICS: ScheduleDiagnostics = {
  postgresNow: null,
  oldestPendingNotifyAt: null,
  duePendingCount: 0,
  futurePendingCount: 0,
  pendingByKind: emptyScheduleKindCounts(),
  dueByKind: emptyScheduleKindCounts(),
  processingCount: 0,
  failedCount: 0,
  cancelledCount: 0,
};

const EMPTY_SIDE_EFFECT_DIAGNOSTICS: SideEffectDiagnostics = {
  postgresNow: null,
  oldestPendingAvailableAt: null,
  duePendingCount: 0,
  pendingByKind: {},
  dueByKind: {},
  processingCount: 0,
  failedCount: 0,
  doneCount: 0,
  oldestPendingAgeSeconds: null,
};

function countSideEffectsByKind(counts: SideEffectKindCounts, kinds: TaskSideEffectKind[]) {
  return kinds.reduce((total, kind) => total + (counts[kind] ?? 0), 0);
}

function remainingBudgetMs(deadline: number, maxStepDurationMs: number) {
  return Math.max(0, Math.min(maxStepDurationMs, deadline - Date.now() - CRON_DEADLINE_GUARD_MS));
}

function hasCronBudget(deadline: number) {
  return remainingBudgetMs(deadline, 1) > 0;
}

function getCronResponseBudgetMs() {
  const configured = Number(process.env.CRON_MAX_RESPONSE_MS ?? MAX_CRON_RESPONSE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : MAX_CRON_RESPONSE_MS;
}

function getDbHealthQueryTimeoutMs() {
  const configured = Number(process.env.CRON_DB_HEALTH_QUERY_TIMEOUT_MS ?? DEFAULT_DB_HEALTH_QUERY_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DB_HEALTH_QUERY_TIMEOUT_MS;
}

function getScheduleBacklogAlertThreshold() {
  const configured = Number(process.env.CRON_SCHEDULE_BACKLOG_ALERT_THRESHOLD ?? DEFAULT_SCHEDULE_BACKLOG_ALERT_THRESHOLD);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_SCHEDULE_BACKLOG_ALERT_THRESHOLD;
}

function emptyScheduleKindCounts(): ScheduleKindCounts {
  return Object.fromEntries(NOTIFICATION_SCHEDULE_KINDS.map((kind) => [kind, 0])) as ScheduleKindCounts;
}

function withAllScheduleKinds(counts: Record<string, number>): ScheduleKindCounts {
  return {
    ...emptyScheduleKindCounts(),
    ...counts,
  };
}

function timeoutFallback<T>(fallback: T, stage: string, timeoutMs: number): T {
  logWarn('cron_notifications_stage_timeout', {
    stage,
    timeoutMs,
  });
  return fallback;
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  stage: string,
): Promise<T> {
  if (timeoutMs <= 0) {
    return Promise.resolve(timeoutFallback(fallback, stage, timeoutMs));
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const guardedPromise = promise.catch((error) => {
    logError('cron_notifications_stage_failed', error, { stage });
    return fallback;
  });

  const timeoutPromise = new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(timeoutFallback(fallback, stage, timeoutMs)), timeoutMs);
  });

  return Promise.race([guardedPromise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function fallbackSchedules(durationMs = 0): ProcessNotificationSchedulesSummary {
  return {
    detectedOverdueTasks: 0,
    backfilledSchedules: 0,
    reclaimedSchedules: 0,
    fetchedSchedules: 0,
    processedSchedules: 0,
    sentSchedules: 0,
    cancelledSchedules: 0,
    rescheduledSchedules: 0,
    failedSchedules: 0,
    durationMs,
    hasMore: true,
    stoppedByTimeLimit: true,
    processed: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    scheduleDiagnostics: EMPTY_SCHEDULE_DIAGNOSTICS,
    schedulesByKindProcessed: emptyScheduleKindCounts(),
  };
}

function addScheduleSummaries(
  target: ProcessNotificationSchedulesSummary,
  increment: ProcessNotificationSchedulesSummary,
) {
  target.detectedOverdueTasks += increment.detectedOverdueTasks;
  target.backfilledSchedules += increment.backfilledSchedules;
  target.reclaimedSchedules += increment.reclaimedSchedules;
  target.fetchedSchedules += increment.fetchedSchedules;
  target.processedSchedules += increment.processedSchedules;
  target.sentSchedules += increment.sentSchedules;
  target.cancelledSchedules += increment.cancelledSchedules;
  target.rescheduledSchedules += increment.rescheduledSchedules;
  target.failedSchedules += increment.failedSchedules;
  target.durationMs += increment.durationMs;
  target.hasMore = target.hasMore || increment.hasMore;
  target.stoppedByTimeLimit = target.stoppedByTimeLimit || increment.stoppedByTimeLimit;
  target.processed = target.processedSchedules;
  target.sent = target.sentSchedules;
  target.failed = target.failedSchedules;
  target.cancelled = target.cancelledSchedules;
  target.scheduleDiagnostics = increment.scheduleDiagnostics;

  for (const kind of NOTIFICATION_SCHEDULE_KINDS) {
    target.schedulesByKindProcessed[kind] += increment.schedulesByKindProcessed[kind] ?? 0;
  }
}

function fallbackSideEffects(durationMs = 0): ProcessTaskSideEffectsSummary {
  return {
    fetched: 0,
    processed: 0,
    done: 0,
    failed: 0,
    retried: 0,
    cancelled: 0,
    durationMs,
    hasMore: true,
    stoppedByTimeLimit: true,
    sideEffectDiagnostics: EMPTY_SIDE_EFFECT_DIAGNOSTICS,
  };
}

function fallbackBackfill(durationMs = 0): BackfillSummary {
  return {
    backfilledSchedules: 0,
    durationMs,
    hasMore: true,
    stoppedByTimeLimit: true,
    backfillDiagnostics: {
      scannedTasks: 0,
      missingSchedules: 0,
      backfilledSchedules: 0,
      skippedReasons: { time_limit: 1 },
    },
  };
}

function fallbackCalendarSync(durationMs = 0): CalendarSyncSummary {
  return {
    scanned: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    stoppedByTimeLimit: true,
    durationMs,
    sideEffects: fallbackSideEffects(durationMs),
  };
}

function fallbackOverdueDetection(durationMs = 0): OverdueDetectionSummary {
  return {
    detectedOverdueTasks: 0,
    durationMs,
    hasMore: true,
    stoppedByTimeLimit: true,
  };
}

function isAuthorizedCronRequest(context: HandlerContext): boolean {
  const vercelCronHeader = context.request.headers['x-vercel-cron'];
  if (vercelCronHeader === '1') return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = context.request.headers.authorization;
  return authHeader === `Bearer ${secret}`;
}

async function requireNotificationAuth(context: HandlerContext) {
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

    logError('notifications_auth_failed', error, getRequestMeta(context.request));
    return json(500, { error: 'Erro interno ao autenticar' });
  }
}

function resolveNotificationId(context: HandlerContext): string | null {
  const paramId = context.request.params?.id;
  if (paramId) return paramId;

  const queryId = context.request.query?.id;
  if (typeof queryId === 'string') return queryId;
  if (Array.isArray(queryId) && typeof queryId[0] === 'string') return queryId[0];
  return null;
}

function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function normalizeDateQueryValue(value: unknown, endOfDay = false): string | null | undefined {
  const raw = firstQueryValue(value);
  if (raw === undefined || raw.trim() === '') return undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseNotificationFilters(source: Record<string, unknown>): NotificationListFilters | { error: string } {
  const filters: NotificationListFilters = {};
  const search = firstQueryValue(source.search)?.trim();
  if (search) filters.search = search.slice(0, 120);

  const read = typeof source.read === 'boolean'
    ? (source.read ? 'true' : 'false')
    : firstQueryValue(source.read);
  if (read === 'true' || read === 'read') filters.read = true;
  else if (read === 'false' || read === 'unread') filters.read = false;
  else if (read && read !== 'all') return { error: 'Filtro de leitura invÃ¡lido.' };

  const tone = firstQueryValue(source.tone);
  if (tone && tone !== 'all') {
    if (!NOTIFICATION_TONES.includes(tone as NotificationTone)) return { error: 'Tipo de notificaÃ§Ã£o invÃ¡lido.' };
    filters.tone = tone as NotificationTone;
  }

  const kind = firstQueryValue(source.kind);
  if (kind && kind !== 'all') {
    if (!NOTIFICATION_SCHEDULE_KINDS.includes(kind as NotificationScheduleKind)) return { error: 'Origem de notificaÃ§Ã£o invÃ¡lida.' };
    filters.kind = kind as NotificationScheduleKind;
  }

  const createdFrom = normalizeDateQueryValue(source.createdFrom ?? source.from);
  if (createdFrom === null) return { error: 'Data inicial invÃ¡lida.' };
  if (createdFrom) filters.createdFrom = createdFrom;

  const createdTo = normalizeDateQueryValue(source.createdTo ?? source.to ?? source.before, true);
  if (createdTo === null) return { error: 'Data final invÃ¡lida.' };
  if (createdTo) filters.createdTo = createdTo;

  return filters;
}

function parseNotificationListOptions(query: Record<string, unknown> | undefined): ListNotificationsOptions | { error: string } {
  const source = query ?? {};
  const filters = parseNotificationFilters(source);
  if ('error' in filters) return filters;
  const limitRaw = firstQueryValue(source.limit);
  const limit = limitRaw ? Number(limitRaw) : 50;
  if (limitRaw && (!Number.isFinite(limit) || limit <= 0)) return { error: 'Limite de notificaÃ§Ãµes invÃ¡lido.' };

  return {
    ...filters,
    cursor: firstQueryValue(source.cursor) ?? null,
    limit,
  };
}

function parseNotificationDeleteFilters(request: HandlerContext['request']): NotificationListFilters | { error: string } {
  const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
  return parseNotificationFilters({
    ...(request.query ?? {}),
    ...body,
  });
}

export async function handleNotificationsCollection(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  const organization = await requireCurrentOrganization(sql, user);
  const organizationId = organization.id;

  if (request.method === 'GET') {
    const options = parseNotificationListOptions(request.query);
    if ('error' in options) return json(400, { error: options.error });

    try {
      const [page, enabled, preferences] = await Promise.all([
        listNotificationsForUser(sql, user.id, { ...options, organizationId }),
        getNotificationsEnabled(sql, user.id),
        getNotificationPreferences(sql, user.id),
      ]);
      return json(200, {
        notifications: page.notifications,
        pageInfo: page.pageInfo,
        enabled,
        preferences,
        pushConfigured: isPushConfigured(),
        pushPublicKey: getPushPublicKey(),
      });
    } catch (error) {
      if (error instanceof NotificationCursorError) {
        return json(400, { error: 'Cursor de notificações inválido.' });
      }

      logError('notifications_list_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao buscar notificações' });
    }
  }

  if (request.method === 'POST') {
    const parsed = createNotificationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

    try {
      const result = await createNotification(sql, {
        userId: user.id,
        organizationId,
        ...parsed.data,
      });
      logInfo('notification_created', getRequestMeta(request, {
        userId: user.id,
        notificationId: result.notification.id,
        created: result.created,
      }));
      return json(result.created ? 201 : 200, result);
    } catch (error) {
      if (error instanceof NotificationReferenceUnavailableError) {
        logWarn('notification_create_skipped_missing_reference', getRequestMeta(request, {
          userId: user.id,
        }));
        return json(409, { error: 'Referência da notificação não está mais disponível' });
      }

      logError('notification_create_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao registrar notificação' });
    }
  }

  if (request.method === 'DELETE') {
    const filters = parseNotificationDeleteFilters(request);
    if ('error' in filters) return json(400, { error: filters.error });

    try {
      const deletedCount = await clearNotificationsForUser(sql, user.id, { ...filters, organizationId });
      logInfo('notifications_cleared', getRequestMeta(request, { userId: user.id, deletedCount, filters }));
      return json(200, { deletedCount });
    } catch (error) {
      logError('notifications_clear_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao limpar notificações' });
    }
  }

  return methodNotAllowed();
}

export async function handleNotificationProcessDue(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const { request, sql } = context;
  const user = auth.user;
  const organization = await requireCurrentOrganization(sql, user);
  const organizationId = organization.id;

  if (request.method !== 'POST') return methodNotAllowed();

  try {
    const sideEffects = await processTaskSideEffects(
      sql,
      USER_NOTIFICATION_SIDE_EFFECT_LIMIT,
      USER_NOTIFICATION_SIDE_EFFECT_DURATION_MS,
      {
        ensureInfrastructure: false,
        notificationSchedulesOnly: true,
        userId: user.id,
      },
    );
    const backfill = await backfillMissingNotificationSchedules(sql, BACKFILL_LIMIT, BACKFILL_DURATION_MS, {
      ensureInfrastructure: false,
      userId: user.id,
    });
    const schedules = await processDueNotificationSchedules(sql, USER_DUE_SCHEDULE_LIMIT, USER_DUE_SCHEDULE_DURATION_MS, {
      ensureInfrastructure: false,
      reclaimStuckProcessing: false,
      userId: user.id,
    });
    if (sideEffects.done > 0) {
      const postSideEffectSchedules = await processDueNotificationSchedules(
        sql,
        USER_DUE_SCHEDULE_LIMIT,
        USER_DUE_SCHEDULE_DURATION_MS,
        {
          ensureInfrastructure: false,
          reclaimStuckProcessing: false,
          userId: user.id,
        },
      );
      addScheduleSummaries(schedules, postSideEffectSchedules);
    }
    const pushRetries = await retryTemporaryPushDeliveries(sql, 5);
    const [page, enabled, preferences] = await Promise.all([
      listNotificationsForUser(sql, user.id, { organizationId }),
      getNotificationsEnabled(sql, user.id),
      getNotificationPreferences(sql, user.id),
    ]);

    logInfo('notifications_user_due_processed', getRequestMeta(request, {
      userId: user.id,
      fetched: schedules.fetchedSchedules,
      processed: schedules.processedSchedules,
      sent: schedules.sentSchedules,
      failed: schedules.failedSchedules,
      sideEffectsProcessed: sideEffects.processed,
      sideEffectsDone: sideEffects.done,
      backfilledSchedules: backfill.backfilledSchedules,
      pushRetries,
      durationMs: schedules.durationMs,
    }));

    return json(200, {
      ok: true,
      schedules,
      sideEffects,
      backfill,
      pushRetries,
      notifications: page.notifications,
      pageInfo: page.pageInfo,
      enabled,
      preferences,
      pushConfigured: isPushConfigured(),
      pushPublicKey: getPushPublicKey(),
    });
  } catch (error) {
    logError('notifications_user_due_process_failed', error, getRequestMeta(request, { userId: user.id }));
    return json(500, { error: 'Erro ao processar notificações vencidas' });
  }
}

export async function handleNotificationSchedulesQueue(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const { request, sql } = context;
  const user = auth.user;
  const organization = await requireCurrentOrganization(sql, user);
  const organizationId = organization.id;

  if (request.method !== 'GET') return methodNotAllowed();

  const taskId = firstQueryValue(request.query?.taskId) ?? null;
  const statusRaw = firstQueryValue(request.query?.status);
  const status = statusRaw && NOTIFICATION_SCHEDULE_STATUSES.includes(statusRaw as NotificationScheduleStatus)
    ? statusRaw as NotificationScheduleStatus
    : null;
  const limitRaw = firstQueryValue(request.query?.limit);
  const limit = limitRaw ? Number(limitRaw) : 100;

  if (statusRaw && !status) return json(400, { error: 'Status da fila inválido.' });
  if (!Number.isFinite(limit) || limit <= 0) return json(400, { error: 'Limite da fila inválido.' });

  try {
    const [schedules, diagnostics] = await Promise.all([
      listNotificationSchedulesForUser(sql, user.id, {
        taskId,
        organizationId,
        status,
        limit,
      }),
      getScheduleDiagnostics(sql, { userId: user.id }),
    ]);
    return json(200, { schedules, diagnostics });
  } catch (error) {
    logError('notification_schedules_queue_failed', error, getRequestMeta(request, { userId: user.id, taskId }));
    return json(500, { error: 'Erro ao carregar fila de notificações' });
  }
}

export async function handleNotificationById(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  const id = resolveNotificationId(context);
  const organization = await requireCurrentOrganization(sql, user);
  const organizationId = organization.id;

  if (!id) {
    return json(400, { error: 'Notificação não encontrada' });
  }

  if (request.method !== 'PUT') return methodNotAllowed();

  const parsed = updateNotificationSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: 'Envie o campo "read" com true ou false.' });
  }

  try {
    const notification = await markNotificationReadState(sql, user.id, organizationId, id, parsed.data.read);
    if (!notification) {
      return json(404, { error: 'Notificação não encontrada' });
    }

    logInfo('notification_updated', getRequestMeta(request, { userId: user.id, notificationId: id }));
    return json(200, { notification });
  } catch (error) {
    logError('notification_update_failed', error, getRequestMeta(request, { userId: user.id, notificationId: id }));
    return json(500, { error: 'Erro ao atualizar notificação' });
  }
}

export async function handleNotificationMarkAllRead(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  const organization = await requireCurrentOrganization(sql, user);
  const organizationId = organization.id;

  if (request.method !== 'POST') return methodNotAllowed();

  try {
    const updatedCount = await markAllNotificationsRead(sql, user.id, organizationId);
    logInfo('notifications_mark_all_read', getRequestMeta(request, { userId: user.id, updatedCount }));
    return json(200, { updatedCount });
  } catch (error) {
    logError('notifications_mark_all_read_failed', error, getRequestMeta(request, { userId: user.id }));
    return json(500, { error: 'Erro ao marcar notificações como lidas' });
  }
}

export async function handleNotificationSettings(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  if (request.method === 'GET') {
    try {
      const [enabled, preferences] = await Promise.all([
        getNotificationsEnabled(sql, user.id),
        getNotificationPreferences(sql, user.id),
      ]);
      return json(200, {
        enabled,
        preferences,
        pushConfigured: isPushConfigured(),
        pushPublicKey: getPushPublicKey(),
      });
    } catch (error) {
      logError('notification_settings_get_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao carregar preferência de notificações' });
    }
  }

  if (request.method === 'PUT') {
    const parsed = updateNotificationSettingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

    try {
      if (parsed.data.enabled !== undefined) {
        await setNotificationsEnabled(sql, user.id, parsed.data.enabled);
      }
      const preferences = parsed.data.preferences
        ? await setNotificationPreferences(sql, user.id, parsed.data.preferences)
        : await getNotificationPreferences(sql, user.id);
      const enabled = parsed.data.enabled ?? await getNotificationsEnabled(sql, user.id);
      if (parsed.data.enabled === false) {
        try {
          await cancelPendingNotificationSchedulesForUser(sql, user.id, {
            reason: 'notifications_disabled',
            caller: 'handleNotificationSettings',
          });
        } catch (error) {
          logError('notification_settings_cancel_schedules_failed', error, getRequestMeta(request, { userId: user.id }));
        }
      }
      logInfo('notification_settings_updated', getRequestMeta(request, {
        userId: user.id,
        enabled,
        preferencesUpdated: Boolean(parsed.data.preferences),
      }));
      return json(200, { enabled, preferences });
    } catch (error) {
      logError('notification_settings_update_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao salvar preferência de notificações' });
    }
  }

  return methodNotAllowed();
}

export async function handleNotificationPushSubscriptions(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  if (request.method === 'POST') {
    const parsed = pushSubscriptionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

    try {
      await upsertPushSubscription(sql, user.id, parsed.data);
      return json(201, { ok: true });
    } catch (error) {
      logError('push_subscription_upsert_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao registrar dispositivo para notificações' });
    }
  }

  if (request.method === 'DELETE') {
    const parsed = deletePushSubscriptionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

    try {
      await deletePushSubscription(sql, user.id, parsed.data.endpoint);
      return empty(204);
    } catch (error) {
      logError('push_subscription_delete_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao remover dispositivo de notificações' });
    }
  }

  return methodNotAllowed();
}

export async function handleAlarmSnooze(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const { request, sql } = context;
  if (request.method !== 'POST') return methodNotAllowed();

  const scheduleId = resolveNotificationId(context);
  if (!scheduleId) {
    return json(400, { error: 'Alarme não encontrado' });
  }

  const parsed = snoozeAlarmSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  try {
    const result = await snoozeAlarmSchedule(sql, auth.user.id, scheduleId, parsed.data.minutes);
    if (!result) return json(404, { error: 'Alarme não encontrado' });
    return json(201, result);
  } catch (error) {
    logError('alarm_snooze_failed', error, getRequestMeta(request, { userId: auth.user.id, scheduleId }));
    return json(500, { error: 'Erro ao adiar alarme' });
  }
}

function isAuthorizedCronSecretRequest(context: HandlerContext): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = context.request.headers.authorization;
  return authHeader === `Bearer ${secret}`;
}

function toCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown_error';
}

async function measureQuery(
  stage: string,
  query: () => Promise<Array<Record<string, unknown>>>,
  timeoutMs = getDbHealthQueryTimeoutMs(),
) {
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const queryPromise = query()
    .then((rows) => ({
      step: {
        ok: true,
        durationMs: Date.now() - startedAt,
      },
      rows,
    }))
    .catch((error) => ({
      step: {
        ok: false,
        durationMs: Date.now() - startedAt,
        error: errorMessage(error),
      },
      rows: [] as Array<Record<string, unknown>>,
    }));

  const timeoutPromise = new Promise<{
    step: MeasuredQueryStep;
    rows: Array<Record<string, unknown>>;
  }>((resolve) => {
    timeout = setTimeout(() => {
      resolve({
        step: {
          ok: false,
          durationMs: Date.now() - startedAt,
          error: `${stage}_timeout`,
        },
        rows: [],
      });
    }, timeoutMs);
  });

  return Promise.race([queryPromise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function skippedStep(): MeasuredQueryStep {
  return { ok: false, durationMs: 0, skipped: true, error: 'skipped_after_db_connect_failure' };
}

async function runCronDbHealth(sql: HandlerContext['sql'], options: { includeLocks?: boolean } = {}): Promise<CronDbHealth & {
  locks?: LockDiagnostics;
}> {
  const connection = getDatabaseConnectionMetadata();
  const steps: Record<string, MeasuredQueryStep> = {};
  const counts: CronDbHealth['counts'] = {
    taskSideEffectsPending: null,
    taskSideEffectsDue: null,
    taskSideEffectsNotificationDue: null,
    taskSideEffectsDueByKind: {},
    schedulesPending: null,
    schedulesDue: null,
    schedulesDueByKind: emptyScheduleKindCounts(),
    schedulesProcessing: null,
    schedulesStuckProcessing: null,
    missingScheduleCandidates: null,
    tasksPending: null,
    overdueCandidates: null,
  };
  const db: CronDbHealth['db'] = {
    nowMs: null,
    taskSideEffectsPendingMs: null,
    taskSideEffectsDueMs: null,
    taskSideEffectsNotificationDueMs: null,
    taskSideEffectsDueByKindMs: null,
    schedulesPendingMs: null,
    schedulesDueMs: null,
    schedulesProcessingMs: null,
    missingScheduleCandidatesMs: null,
    tasksPendingMs: null,
    overdueCandidatesMs: null,
  };

  const now = await measureQuery('db_now', () => sql`SELECT NOW() AS now`);
  steps.now = now.step;
  db.nowMs = now.step.durationMs;

  const shouldSkipCounts = !now.step.ok;
  if (shouldSkipCounts) {
    steps.taskSideEffectsPending = skippedStep();
    steps.taskSideEffectsDue = skippedStep();
    steps.taskSideEffectsNotificationDue = skippedStep();
    steps.taskSideEffectsDueByKind = skippedStep();
    steps.schedulesPending = skippedStep();
    steps.schedulesDue = skippedStep();
    steps.schedulesDueByKind = skippedStep();
    steps.schedulesProcessing = skippedStep();
    steps.missingScheduleCandidates = skippedStep();
    steps.tasksPending = skippedStep();
    steps.overdueCandidates = skippedStep();
    return {
      ok: false,
      slow: true,
      connection,
      db,
      counts,
      steps,
      ...(options.includeLocks ? { locks: await getLockDiagnostics(sql) } : {}),
    };
  }

  const taskSideEffectsPending = await measureQuery(
    'task_side_effects_pending',
    () => sql`
      SELECT COUNT(*) AS count
      FROM task_side_effects
      WHERE status = 'pending'
    `,
  );
  steps.taskSideEffectsPending = taskSideEffectsPending.step;
  db.taskSideEffectsPendingMs = taskSideEffectsPending.step.durationMs;
  counts.taskSideEffectsPending = taskSideEffectsPending.step.ok ? toCount(taskSideEffectsPending.rows[0]?.count) : null;

  const taskSideEffectsDue = await measureQuery(
    'task_side_effects_due',
    () => sql`
      SELECT COUNT(*) AS count
      FROM task_side_effects
      WHERE status = 'pending'
        AND available_at <= NOW()
        AND cancelled_at IS NULL
    `,
  );
  steps.taskSideEffectsDue = taskSideEffectsDue.step;
  db.taskSideEffectsDueMs = taskSideEffectsDue.step.durationMs;
  counts.taskSideEffectsDue = taskSideEffectsDue.step.ok ? toCount(taskSideEffectsDue.rows[0]?.count) : null;

  const taskSideEffectsNotificationDue = await measureQuery(
    'task_side_effects_notification_due',
    () => sql`
      SELECT COUNT(*) AS count
      FROM task_side_effects
      WHERE status = 'pending'
        AND available_at <= NOW()
        AND cancelled_at IS NULL
        AND kind IN ('sync_notification_schedules', 'cancel_notification_schedules')
    `,
  );
  steps.taskSideEffectsNotificationDue = taskSideEffectsNotificationDue.step;
  db.taskSideEffectsNotificationDueMs = taskSideEffectsNotificationDue.step.durationMs;
  counts.taskSideEffectsNotificationDue = taskSideEffectsNotificationDue.step.ok
    ? toCount(taskSideEffectsNotificationDue.rows[0]?.count)
    : null;

  const taskSideEffectsDueByKind = await measureQuery(
    'task_side_effects_due_by_kind',
    () => sql`
      SELECT kind, COUNT(*) AS count
      FROM task_side_effects
      WHERE status = 'pending'
        AND available_at <= NOW()
        AND cancelled_at IS NULL
      GROUP BY kind
      ORDER BY kind ASC
    `,
  );
  steps.taskSideEffectsDueByKind = taskSideEffectsDueByKind.step;
  db.taskSideEffectsDueByKindMs = taskSideEffectsDueByKind.step.durationMs;
  if (taskSideEffectsDueByKind.step.ok) {
    counts.taskSideEffectsDueByKind = Object.fromEntries(
      taskSideEffectsDueByKind.rows.map((row) => [String(row.kind), toCount(row.count)]),
    ) as SideEffectKindCounts;
  }

  const schedulesPending = await measureQuery(
    'notification_schedules_pending',
    () => sql`
      SELECT COUNT(*) AS count
      FROM notification_schedules
      WHERE status = 'pending'
    `,
  );
  steps.schedulesPending = schedulesPending.step;
  db.schedulesPendingMs = schedulesPending.step.durationMs;
  counts.schedulesPending = schedulesPending.step.ok ? toCount(schedulesPending.rows[0]?.count) : null;

  const schedulesDue = await measureQuery(
    'notification_schedules_due',
    () => sql`
      SELECT COUNT(*) AS count
      FROM notification_schedules
      WHERE status = 'pending'
        AND notify_at <= NOW()
        AND sent_at IS NULL
        AND failed_at IS NULL
        AND cancelled_at IS NULL
    `,
  );
  steps.schedulesDue = schedulesDue.step;
  db.schedulesDueMs = schedulesDue.step.durationMs;
  counts.schedulesDue = schedulesDue.step.ok ? toCount(schedulesDue.rows[0]?.count) : null;

  const schedulesDueByKind = await measureQuery(
    'notification_schedules_due_by_kind',
    () => sql`
      SELECT kind, COUNT(*) AS count
      FROM notification_schedules
      WHERE status = 'pending'
        AND notify_at <= NOW()
        AND sent_at IS NULL
        AND failed_at IS NULL
        AND cancelled_at IS NULL
      GROUP BY kind
      ORDER BY kind ASC
    `,
  );
  steps.schedulesDueByKind = schedulesDueByKind.step;
  if (schedulesDueByKind.step.ok) {
    counts.schedulesDueByKind = withAllScheduleKinds(
      Object.fromEntries(schedulesDueByKind.rows.map((row) => [String(row.kind), toCount(row.count)])),
    );
  }

  const schedulesProcessing = await measureQuery(
    'notification_schedules_processing',
    () => sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'processing') AS "processingCount",
        COUNT(*) FILTER (
          WHERE status = 'processing'
            AND processing_started_at < NOW() - INTERVAL '10 minutes'
        ) AS "stuckProcessingCount"
      FROM notification_schedules
    `,
  );
  steps.schedulesProcessing = schedulesProcessing.step;
  db.schedulesProcessingMs = schedulesProcessing.step.durationMs;
  counts.schedulesProcessing = schedulesProcessing.step.ok ? toCount(schedulesProcessing.rows[0]?.processingCount) : null;
  counts.schedulesStuckProcessing = schedulesProcessing.step.ok ? toCount(schedulesProcessing.rows[0]?.stuckProcessingCount) : null;

  const missingScheduleCandidates = await measureQuery(
    'missing_schedule_candidates',
    () => sql`
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE tasks.deleted_at IS NULL
        AND tasks.status = 'pending'
        AND (
          tasks.due_date IS NULL
          OR tasks.due_date >= NOW()
        )
        AND NOT EXISTS (
          SELECT 1
          FROM notification_schedules existing_schedule
          WHERE existing_schedule.user_id = tasks.user_id
            AND existing_schedule.task_id = tasks.id
            AND existing_schedule.status IN ('pending', 'processing')
        )
    `,
  );
  steps.missingScheduleCandidates = missingScheduleCandidates.step;
  db.missingScheduleCandidatesMs = missingScheduleCandidates.step.durationMs;
  counts.missingScheduleCandidates = missingScheduleCandidates.step.ok ? toCount(missingScheduleCandidates.rows[0]?.count) : null;

  const tasksPending = await measureQuery(
    'tasks_pending',
    () => sql`
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE status = 'pending'
        AND deleted_at IS NULL
    `,
  );
  steps.tasksPending = tasksPending.step;
  db.tasksPendingMs = tasksPending.step.durationMs;
  counts.tasksPending = tasksPending.step.ok ? toCount(tasksPending.rows[0]?.count) : null;

  const overdueCandidates = await measureQuery(
    'overdue_candidates',
    () => sql`
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE deleted_at IS NULL
        AND COALESCE(reminder_mode, 'timed') = 'timed'
        AND due_date IS NOT NULL
        AND due_date < NOW()
        AND status IN ('pending', 'overdue')
        AND (
          status = 'pending'
          OR (
            status = 'overdue'
            AND COALESCE(overdue_reminder_intensity, 'normal') <> 'silent'
            AND (
              overdue_expires_at IS NULL
              OR overdue_expires_at > NOW()
            )
          )
        )
    `,
  );
  steps.overdueCandidates = overdueCandidates.step;
  db.overdueCandidatesMs = overdueCandidates.step.durationMs;
  counts.overdueCandidates = overdueCandidates.step.ok ? toCount(overdueCandidates.rows[0]?.count) : null;

  const ok = Object.values(steps).every((step) => step.ok);
  return {
    ok,
    slow: !ok || (db.nowMs ?? Number.POSITIVE_INFINITY) > DB_HEALTH_SLOW_THRESHOLD_MS,
    connection,
    db,
    counts,
    steps,
    ...(options.includeLocks ? { locks: await getLockDiagnostics(sql) } : {}),
  };
}

async function getLockDiagnostics(sql: HandlerContext['sql']): Promise<LockDiagnostics> {
  const startedAt = Date.now();
  const activity = await measureQuery(
    'pg_stat_activity_summary',
    () => sql`
      SELECT
        COUNT(*) FILTER (
          WHERE state = 'active'
            AND query_start < NOW() - INTERVAL '5 seconds'
        ) AS "longRunningActive",
        COUNT(*) FILTER (WHERE wait_event_type = 'Lock') AS "waitingOnLock"
      FROM pg_stat_activity
      WHERE datname = current_database()
    `,
    getDbHealthQueryTimeoutMs(),
  );

  const locks = await measureQuery(
    'pg_locks_summary',
    () => sql`
      SELECT
        COUNT(*) FILTER (WHERE NOT granted) AS "waitingLocksOnReminderTables",
        COUNT(*) FILTER (WHERE granted) AS "grantedLocksOnReminderTables"
      FROM pg_locks locks
      LEFT JOIN pg_class rel ON rel.oid = locks.relation
      WHERE rel.relname IN ('notification_schedules', 'task_side_effects', 'tasks')
    `,
    getDbHealthQueryTimeoutMs(),
  );

  const ok = activity.step.ok && locks.step.ok;
  const activityError = 'error' in activity.step ? activity.step.error : undefined;
  const locksError = 'error' in locks.step ? locks.step.error : undefined;
  return {
    ok,
    durationMs: Date.now() - startedAt,
    longRunningActive: activity.step.ok ? toCount(activity.rows[0]?.longRunningActive) : null,
    waitingOnLock: activity.step.ok ? toCount(activity.rows[0]?.waitingOnLock) : null,
    waitingLocksOnReminderTables: locks.step.ok ? toCount(locks.rows[0]?.waitingLocksOnReminderTables) : null,
    grantedLocksOnReminderTables: locks.step.ok ? toCount(locks.rows[0]?.grantedLocksOnReminderTables) : null,
    ...(!ok ? { error: activityError ?? locksError ?? 'lock_diagnostics_failed' } : {}),
  };
}

function buildPreliminaryScheduleDiagnostics(dbHealth: CronDbHealth): ScheduleDiagnostics {
  const pending = dbHealth.counts.schedulesPending ?? 0;
  const due = dbHealth.counts.schedulesDue ?? 0;
  return {
    postgresNow: dbHealth.steps.now.ok ? new Date().toISOString() : null,
    oldestPendingNotifyAt: null,
    duePendingCount: due,
    futurePendingCount: Math.max(0, pending - due),
    pendingByKind: emptyScheduleKindCounts(),
    dueByKind: dbHealth.counts.schedulesDueByKind,
    processingCount: dbHealth.counts.schedulesProcessing ?? 0,
    failedCount: 0,
    cancelledCount: 0,
  };
}

function buildPreliminarySideEffectDiagnostics(dbHealth: CronDbHealth): SideEffectDiagnostics {
  return {
    postgresNow: dbHealth.steps.now.ok ? new Date().toISOString() : null,
    oldestPendingAvailableAt: null,
    duePendingCount: dbHealth.counts.taskSideEffectsDue ?? 0,
    pendingByKind: {},
    dueByKind: dbHealth.counts.taskSideEffectsDueByKind,
    processingCount: 0,
    failedCount: 0,
    doneCount: 0,
    oldestPendingAgeSeconds: null,
  };
}

function shouldUsePreliminaryScheduleDiagnostics(diagnostics: ScheduleDiagnostics) {
  return diagnostics.postgresNow === null && diagnostics.duePendingCount === 0 && diagnostics.futurePendingCount === 0;
}

function shouldUsePreliminarySideEffectDiagnostics(diagnostics: SideEffectDiagnostics) {
  return diagnostics.postgresNow === null && diagnostics.duePendingCount === 0;
}

function calendarSyncDisabledSummary(reason = 'disabled_in_notification_cron'): CalendarSyncSummary & { skippedReason: string } {
  return {
    scanned: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    stoppedByTimeLimit: false,
    durationMs: 0,
    sideEffects: fallbackSideEffects(0),
    skippedReason: reason,
  };
}

function maintenanceStageDisabledSummary(durationMs = 0, reason = 'disabled_in_notification_cron') {
  return {
    backfilledSchedules: 0,
    durationMs,
    hasMore: false,
    stoppedByTimeLimit: false,
    skippedReason: reason,
    backfillDiagnostics: {
      scannedTasks: 0,
      missingSchedules: 0,
      backfilledSchedules: 0,
      skippedReasons: { [reason]: 1 },
    },
  };
}

function buildCronBacklogWarnings(input: {
  hasMore: boolean;
  stoppedByTimeLimit: boolean;
  schedulesDue: number;
  schedulesProcessed: number;
  notificationSideEffectsDue: number;
  notificationSideEffectsProcessed: number;
  calendarSideEffectsDue: number;
  calendarSideEffectsProcessed: number;
  backfillCandidates: number;
  backfilledSchedules: number;
  overdueCandidates: number;
  overdueDetected: number;
}): CronBacklogWarning[] {
  const warnings: CronBacklogWarning[] = [];

  if (input.hasMore) {
    warnings.push({
      kind: 'has_more',
      message: 'Reminder cron finished with hasMore=true; at least one reminder stage still has pending work.',
    });
  }

  if (input.schedulesDue > DUE_SCHEDULE_LIMIT || input.schedulesDue > input.schedulesProcessed) {
    warnings.push({
      kind: 'schedule_backlog',
      message: `Reminder schedule backlog: ${input.schedulesDue} due before the run, ${input.schedulesProcessed} processed, limit ${DUE_SCHEDULE_LIMIT}.`,
      dueCount: input.schedulesDue,
      processedCount: input.schedulesProcessed,
      limit: DUE_SCHEDULE_LIMIT,
      remainingEstimate: Math.max(0, input.schedulesDue - input.schedulesProcessed),
    });
  }

  if (input.notificationSideEffectsDue > SIDE_EFFECT_LIMIT || input.notificationSideEffectsDue > input.notificationSideEffectsProcessed) {
    warnings.push({
      kind: 'side_effect_backlog',
      message: `Notification side-effect backlog: ${input.notificationSideEffectsDue} due before the run, ${input.notificationSideEffectsProcessed} processed, limit ${SIDE_EFFECT_LIMIT}.`,
      dueCount: input.notificationSideEffectsDue,
      processedCount: input.notificationSideEffectsProcessed,
      limit: SIDE_EFFECT_LIMIT,
      remainingEstimate: Math.max(0, input.notificationSideEffectsDue - input.notificationSideEffectsProcessed),
    });
  }

  if (input.backfillCandidates > BACKFILL_LIMIT || input.backfillCandidates > input.backfilledSchedules) {
    warnings.push({
      kind: 'backfill_backlog',
      message: `Notification backfill backlog: ${input.backfillCandidates} reminders without active schedules before the run, ${input.backfilledSchedules} schedules recreated, limit ${BACKFILL_LIMIT}.`,
      dueCount: input.backfillCandidates,
      processedCount: input.backfilledSchedules,
      limit: BACKFILL_LIMIT,
      remainingEstimate: Math.max(0, input.backfillCandidates - input.backfilledSchedules),
    });
  }

  if (input.calendarSideEffectsDue > CALENDAR_SYNC_LIMIT || input.calendarSideEffectsDue > input.calendarSideEffectsProcessed) {
    warnings.push({
      kind: 'calendar_backlog',
      message: `Calendar sync backlog: ${input.calendarSideEffectsDue} due before the run, ${input.calendarSideEffectsProcessed} processed, limit ${CALENDAR_SYNC_LIMIT}.`,
      dueCount: input.calendarSideEffectsDue,
      processedCount: input.calendarSideEffectsProcessed,
      limit: CALENDAR_SYNC_LIMIT,
      remainingEstimate: Math.max(0, input.calendarSideEffectsDue - input.calendarSideEffectsProcessed),
    });
  }

  if (input.overdueCandidates > OVERDUE_LIMIT || input.overdueCandidates > input.overdueDetected) {
    warnings.push({
      kind: 'overdue_backlog',
      message: `Overdue detection backlog: ${input.overdueCandidates} candidates before the run, ${input.overdueDetected} detected, limit ${OVERDUE_LIMIT}.`,
      dueCount: input.overdueCandidates,
      processedCount: input.overdueDetected,
      limit: OVERDUE_LIMIT,
      remainingEstimate: Math.max(0, input.overdueCandidates - input.overdueDetected),
    });
  }

  return input.stoppedByTimeLimit
    ? warnings.map((warning) => ({ ...warning, message: `${warning.message} The cron response budget was exhausted.` }))
    : warnings;
}

async function createScheduleBacklogInternalAlerts(
  sql: HandlerContext['sql'],
  input: {
    dueCountBeforeRun: number;
    processedCount: number;
    threshold: number;
  },
) {
  if (input.dueCountBeforeRun < input.threshold) return { scannedUsers: 0, created: 0, deduplicated: 0, threshold: input.threshold };

  const rows = await sql`
    SELECT
      user_id AS "userId",
      organization_id AS "organizationId",
      COUNT(*) AS "dueCount",
      MIN(notify_at) AS "oldestNotifyAt"
    FROM notification_schedules
    WHERE status = 'pending'
      AND notify_at <= NOW()
      AND sent_at IS NULL
      AND failed_at IS NULL
      AND cancelled_at IS NULL
    GROUP BY user_id, organization_id
    HAVING COUNT(*) >= ${input.threshold}
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `;

  let created = 0;
  let deduplicated = 0;
  const hourKey = new Date().toISOString().slice(0, 13);

  for (const row of rows) {
    const userId = String(row.userId);
    const organizationId = typeof row.organizationId === 'string' ? row.organizationId : null;
    const dueCount = toCount(row.dueCount);
    const oldestNotifyAt = row.oldestNotifyAt ? new Date(String(row.oldestNotifyAt)).toISOString() : null;
    const result = await createNotification(sql, {
      userId,
      organizationId,
      title: 'Fila de avisos em recuperação',
      message: `${dueCount} avisos vencidos ainda nao foram processados. O sistema esta recriando e enviando a fila aos poucos.`,
      tone: 'warning',
      target: { type: 'notifications' },
      dedupeKey: `internal:schedule-backlog:${organizationId ?? userId}:${hourKey}`,
      sendPush: false,
    });
    if (result.created) created += 1;
    else deduplicated += 1;
    logWarn('cron_notifications_internal_backlog_alert', {
      userId,
      dueCount,
      oldestNotifyAt,
      processedCount: input.processedCount,
      threshold: input.threshold,
      notificationId: result.notification.id,
      created: result.created,
    });
  }

  return {
    scannedUsers: rows.length,
    created,
    deduplicated,
    threshold: input.threshold,
  };
}

export async function handleAlarmDismiss(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const { request, sql } = context;
  if (request.method !== 'POST') return methodNotAllowed();

  const scheduleId = resolveNotificationId(context);
  if (!scheduleId) {
    return json(400, { error: 'Alarme não encontrado' });
  }

  try {
    const result = await dismissAlarmSchedule(sql, auth.user.id, scheduleId);
    if (!result) return json(404, { error: 'Alarme não encontrado' });
    return json(200, result);
  } catch (error) {
    logError('alarm_dismiss_failed', error, getRequestMeta(request, { userId: auth.user.id, scheduleId }));
    return json(500, { error: 'Erro ao fechar alarme' });
  }
}

export async function handleCronHealth(context: HandlerContext): Promise<HandlerResult> {
  const { request, sql } = context;
  const startedAt = Date.now();

  if (request.method !== 'GET') return methodNotAllowed();

  if (!isAuthorizedCronSecretRequest(context)) {
    return json(401, { error: 'Não autorizado' });
  }

  const dbHealth = await runCronDbHealth(sql, { includeLocks: true });
  return json(200, {
    ok: dbHealth.ok,
    durationMs: Date.now() - startedAt,
    db: dbHealth.db,
    counts: dbHealth.counts,
    steps: dbHealth.steps,
    connection: dbHealth.connection,
    locks: dbHealth.locks,
  });
}

export async function handleNotificationsCron(context: HandlerContext): Promise<HandlerResult> {
  const { request, sql } = context;
  const startedAt = Date.now();
  const deadline = startedAt + getCronResponseBudgetMs();

  if (request.method !== 'GET') return methodNotAllowed();

  if (!isAuthorizedCronRequest(context)) {
    return json(401, { error: 'Não autorizado' });
  }

  try {
    const dbHealth = await runCronDbHealth(sql);
    const preliminaryScheduleDiagnostics = buildPreliminaryScheduleDiagnostics(dbHealth);
    const preliminarySideEffectDiagnostics = buildPreliminarySideEffectDiagnostics(dbHealth);

    if (!dbHealth.steps.now.ok) {
      const durationMs = Date.now() - startedAt;
      const schedules = {
        fetched: 0,
        processed: 0,
        sent: 0,
        failed: 0,
        cancelled: 0,
        rescheduled: 0,
        reclaimed: 0,
        durationMs: 0,
        stoppedByTimeLimit: false,
        hasMore: true,
        schedulesByKindProcessed: emptyScheduleKindCounts(),
        skippedReason: 'db_health_unavailable',
      };
      const sideEffects = {
        ...fallbackSideEffects(0),
        hasMore: true,
        stoppedByTimeLimit: false,
        sideEffectDiagnostics: preliminarySideEffectDiagnostics,
        skippedReason: 'db_health_unavailable',
      };
      const backfill = {
        ...fallbackBackfill(0),
        hasMore: false,
        stoppedByTimeLimit: false,
        skippedReason: 'db_health_unavailable',
      };
      const calendarSync = calendarSyncDisabledSummary();
      const overdueDetection = {
        ...fallbackOverdueDetection(0),
        hasMore: false,
        stoppedByTimeLimit: false,
        skippedReason: 'db_health_unavailable',
      };

      logWarn('cron_notifications_skipped_by_db_health_unavailable', getRequestMeta(request, {
        durationMs,
        dbHealth,
        scheduleDiagnostics: preliminaryScheduleDiagnostics,
        sideEffectDiagnostics: preliminarySideEffectDiagnostics,
      }));

      return json(200, {
        ok: true,
        durationMs,
        stoppedByTimeLimit: false,
        hasMore: true,
        skippedByDbHealth: true,
        dbHealth,
        schedules,
        sideEffects,
        backfill,
        calendarSync,
        overdueDetection,
        scheduleDiagnostics: preliminaryScheduleDiagnostics,
        sideEffectDiagnostics: preliminarySideEffectDiagnostics,
        backfillDiagnostics: backfill.backfillDiagnostics,
      });
    }

    if (dbHealth.slow) {
      logWarn('cron_notifications_db_health_slow', getRequestMeta(request, {
        dbHealth,
        scheduleDiagnostics: preliminaryScheduleDiagnostics,
        sideEffectDiagnostics: preliminarySideEffectDiagnostics,
      }));
    }

    const hasDueSchedules = preliminaryScheduleDiagnostics.duePendingCount > 0;
    const hasStuckProcessingSchedules = (dbHealth.counts.schedulesStuckProcessing ?? 0) > 0;
    const shouldProcessSchedules = hasDueSchedules || hasStuckProcessingSchedules;
    const scheduleBudgetMs = remainingBudgetMs(deadline, DUE_SCHEDULE_DURATION_MS);
    const result = shouldProcessSchedules
      ? await withTimeout(
          processDueNotificationSchedules(sql, DUE_SCHEDULE_LIMIT, scheduleBudgetMs, {
            ensureInfrastructure: false,
            precomputedDiagnostics: preliminaryScheduleDiagnostics,
            reclaimStuckProcessingLimit: DUE_SCHEDULE_RECLAIM_LIMIT,
          }),
          scheduleBudgetMs,
          fallbackSchedules(scheduleBudgetMs),
          'processDueNotificationSchedules',
        )
      : {
          detectedOverdueTasks: 0,
          backfilledSchedules: 0,
          reclaimedSchedules: 0,
          fetchedSchedules: 0,
          processedSchedules: 0,
          sentSchedules: 0,
          cancelledSchedules: 0,
          rescheduledSchedules: 0,
          failedSchedules: 0,
          durationMs: 0,
          hasMore: false,
          stoppedByTimeLimit: false,
          processed: 0,
          sent: 0,
          failed: 0,
          cancelled: 0,
          scheduleDiagnostics: preliminaryScheduleDiagnostics,
          schedulesByKindProcessed: emptyScheduleKindCounts(),
        };
    if (!shouldProcessSchedules) {
      logInfo('cron_notifications_schedules_skipped_no_due', getRequestMeta(request, {
        scheduleDiagnostics: preliminaryScheduleDiagnostics,
      }));
    }
    const notificationSideEffectsDue = countSideEffectsByKind(
      dbHealth.counts.taskSideEffectsDueByKind,
      ['sync_notification_schedules', 'cancel_notification_schedules'],
    );
    const hasDueNotificationSideEffects = notificationSideEffectsDue > 0;
    const sideEffects = hasDueNotificationSideEffects && hasCronBudget(deadline)
      ? await (() => {
          const budgetMs = remainingBudgetMs(deadline, SIDE_EFFECT_PROCESS_DURATION_MS);
          return withTimeout(
            processTaskSideEffects(sql, SIDE_EFFECT_LIMIT, budgetMs, {
              ensureInfrastructure: false,
              notificationSchedulesOnly: true,
              precomputedDiagnostics: preliminarySideEffectDiagnostics,
            }),
            budgetMs,
            fallbackSideEffects(budgetMs),
            'processTaskSideEffects',
          );
        })()
      : {
          ...fallbackSideEffects(0),
          hasMore: false,
          stoppedByTimeLimit: false,
          sideEffectDiagnostics: preliminarySideEffectDiagnostics,
          skippedReason: hasDueNotificationSideEffects ? 'time_limit' : 'no_notification_side_effects_due',
        };
    if (sideEffects.done > 0 && hasCronBudget(deadline)) {
      const budgetMs = remainingBudgetMs(deadline, DUE_SCHEDULE_DURATION_MS);
      const postSideEffectSchedules = await withTimeout(
        processDueNotificationSchedules(sql, DUE_SCHEDULE_LIMIT, budgetMs, {
          ensureInfrastructure: false,
          reclaimStuckProcessing: false,
        }),
        budgetMs,
        fallbackSchedules(budgetMs),
        'processDueNotificationSchedulesAfterSideEffects',
      );
      addScheduleSummaries(result, postSideEffectSchedules);
    }
    const pushRetries = hasCronBudget(deadline)
      ? await (() => {
          const budgetMs = remainingBudgetMs(deadline, 2500);
          return withTimeout(
            retryTemporaryPushDeliveries(sql, 10),
            budgetMs,
            { scanned: 0, retried: 0, delivered: 0, failed: 0, skipped: 0 },
            'retryTemporaryPushDeliveries',
          );
        })()
      : { scanned: 0, retried: 0, delivered: 0, failed: 0, skipped: 0 };
    const hasBackfillCandidates = (dbHealth.counts.missingScheduleCandidates ?? 0) > 0;
    const maintenanceStagesEnabled = (process.env.CRON_ENABLE_MAINTENANCE_STAGES === 'true' || hasBackfillCandidates) && !dbHealth.slow;
    const hasOverdueCandidates = (dbHealth.counts.overdueCandidates ?? 0) > 0;
    const dbHealthMaintenanceSkipReason = dbHealth.slow
      ? 'db_health_slow'
      : hasBackfillCandidates
        ? 'time_limit'
        : 'disabled_in_notification_cron';
    const backfill = maintenanceStagesEnabled && hasCronBudget(deadline)
      ? await (() => {
          const budgetMs = remainingBudgetMs(deadline, BACKFILL_DURATION_MS);
          return withTimeout(
            backfillMissingNotificationSchedules(sql, BACKFILL_LIMIT, budgetMs, { ensureInfrastructure: false }),
            budgetMs,
            fallbackBackfill(budgetMs),
            'backfillMissingNotificationSchedules',
          );
        })()
      : maintenanceStageDisabledSummary(0, dbHealthMaintenanceSkipReason);
    const externalCalendarSideEffectsDue = countSideEffectsByKind(
      dbHealth.counts.taskSideEffectsDueByKind,
      ['sync_external_calendar', 'delete_external_calendar_event'],
    );
    const hasDueExternalCalendarSideEffects = externalCalendarSideEffectsDue > 0;
    const externalCalendarSkipReason = dbHealth.slow
      ? 'db_health_slow'
      : hasDueExternalCalendarSideEffects
        ? 'time_limit'
        : 'no_external_calendar_side_effects_due';
    const calendarSync = hasDueExternalCalendarSideEffects && !dbHealth.slow && hasCronBudget(deadline)
      ? await (() => {
          const budgetMs = remainingBudgetMs(deadline, CALENDAR_SYNC_DURATION_MS);
          return withTimeout(
            processExternalCalendarSideEffects(sql, CALENDAR_SYNC_LIMIT, budgetMs),
            budgetMs,
            fallbackCalendarSync(budgetMs),
            'processExternalCalendarSideEffects',
          );
        })()
      : calendarSyncDisabledSummary(externalCalendarSkipReason);
    const overdueDetection = hasOverdueCandidates && hasCronBudget(deadline)
      ? await (() => {
          const budgetMs = remainingBudgetMs(deadline, OVERDUE_DURATION_MS);
          return withTimeout(
            detectOverdueNotificationSchedules(sql, OVERDUE_LIMIT, budgetMs, { ensureInfrastructure: false }),
            budgetMs,
            fallbackOverdueDetection(budgetMs),
            'detectOverdueNotificationSchedules',
          );
        })()
      : {
          ...fallbackOverdueDetection(0),
          hasMore: false,
          stoppedByTimeLimit: false,
          skippedReason: hasOverdueCandidates ? 'time_limit' : 'no_overdue_candidates',
        };

    result.backfilledSchedules = backfill.backfilledSchedules;
    result.detectedOverdueTasks = overdueDetection.detectedOverdueTasks;
    const effectiveScheduleDiagnostics = shouldUsePreliminaryScheduleDiagnostics(result.scheduleDiagnostics)
      ? preliminaryScheduleDiagnostics
      : result.scheduleDiagnostics;
    const effectiveSideEffectDiagnostics = shouldUsePreliminarySideEffectDiagnostics(sideEffects.sideEffectDiagnostics)
      ? preliminarySideEffectDiagnostics
      : sideEffects.sideEffectDiagnostics;
    result.scheduleDiagnostics = effectiveScheduleDiagnostics;
    sideEffects.sideEffectDiagnostics = effectiveSideEffectDiagnostics;
    const scheduleDurationMs = result.durationMs;
    const scheduleStoppedByTimeLimit = result.stoppedByTimeLimit;
    const scheduleHasMore = result.hasMore;
    const stoppedByTimeLimit =
      Date.now() >= deadline ||
      result.stoppedByTimeLimit ||
      sideEffects.stoppedByTimeLimit ||
      Boolean('stoppedByTimeLimit' in backfill && backfill.stoppedByTimeLimit) ||
      calendarSync.stoppedByTimeLimit ||
      Boolean('stoppedByTimeLimit' in overdueDetection && overdueDetection.stoppedByTimeLimit);
    const hasMore =
      result.hasMore ||
      sideEffects.hasMore ||
      backfill.hasMore ||
      overdueDetection.hasMore ||
      stoppedByTimeLimit;
    const durationMs = Date.now() - startedAt;
    result.hasMore = hasMore;
    result.stoppedByTimeLimit = stoppedByTimeLimit;
    result.durationMs = durationMs;
    const schedules = {
      fetched: result.fetchedSchedules,
      processed: result.processedSchedules,
      sent: result.sentSchedules,
      failed: result.failedSchedules,
      cancelled: result.cancelledSchedules,
      rescheduled: result.rescheduledSchedules,
      reclaimed: result.reclaimedSchedules,
      durationMs: scheduleDurationMs,
      stoppedByTimeLimit: scheduleStoppedByTimeLimit,
      hasMore: scheduleHasMore,
      schedulesByKindProcessed: result.schedulesByKindProcessed,
    };
    const backlogWarnings = buildCronBacklogWarnings({
      hasMore,
      stoppedByTimeLimit,
      schedulesDue: effectiveScheduleDiagnostics.duePendingCount,
      schedulesProcessed: result.processedSchedules,
      notificationSideEffectsDue,
      notificationSideEffectsProcessed: sideEffects.processed,
      calendarSideEffectsDue: externalCalendarSideEffectsDue,
      calendarSideEffectsProcessed: calendarSync.scanned,
      backfillCandidates: dbHealth.counts.missingScheduleCandidates ?? 0,
      backfilledSchedules: backfill.backfilledSchedules,
      overdueCandidates: dbHealth.counts.overdueCandidates ?? 0,
      overdueDetected: overdueDetection.detectedOverdueTasks,
    });
    const internalAlerts = await withTimeout(
      createScheduleBacklogInternalAlerts(sql, {
        dueCountBeforeRun: effectiveScheduleDiagnostics.duePendingCount,
        processedCount: result.processedSchedules,
        threshold: getScheduleBacklogAlertThreshold(),
      }),
      remainingBudgetMs(deadline, 1000),
      {
        scannedUsers: 0,
        created: 0,
        deduplicated: 0,
        threshold: getScheduleBacklogAlertThreshold(),
      },
      'createScheduleBacklogInternalAlerts',
    );
    if (backlogWarnings.length > 0) {
      logWarn('cron_notifications_backlog_warning', getRequestMeta(request, {
        backlogWarnings,
        internalAlerts,
        hasMore,
        stoppedByTimeLimit,
        schedules,
        sideEffects,
        pushRetries,
        calendarSync,
        overdueDetection,
        scheduleDiagnostics: effectiveScheduleDiagnostics,
        sideEffectDiagnostics: effectiveSideEffectDiagnostics,
      }));
    }
    logInfo('cron_notifications_completed', getRequestMeta(request, {
      durationMs,
      stoppedByTimeLimit,
      hasMore,
      backlogWarnings,
      internalAlerts,
      sideEffects,
      schedules,
      pushRetries,
      dbHealth,
      scheduleDiagnostics: effectiveScheduleDiagnostics,
      sideEffectDiagnostics: effectiveSideEffectDiagnostics,
      backfillDiagnostics: backfill.backfillDiagnostics,
      backfill,
      calendarSync,
      overdueDetection,
    }));
    return json(200, {
      ok: true,
      ...result,
      durationMs,
      stoppedByTimeLimit,
      hasMore,
      schedules,
      sideEffects,
      backfill,
      pushRetries,
      calendarSync,
      overdueDetection,
      backlogWarnings,
      internalAlerts,
      dbHealth,
      scheduleDiagnostics: effectiveScheduleDiagnostics,
      sideEffectDiagnostics: effectiveSideEffectDiagnostics,
      backfillDiagnostics: backfill.backfillDiagnostics,
    });
  } catch (error) {
    logError('cron_notifications_failed', error, getRequestMeta(request));
    return json(500, { error: 'Erro ao gerar notificações agendadas' });
  }
}
