import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../auth.js';
import { getDatabaseConnectionMetadata } from '../db.js';
import { logError, logInfo, logWarn } from '../logger.js';
import { processPendingCalendarSyncs } from '../calendar/calendarSync.js';
import {
  clearNotificationsForUser,
  createNotification,
  deletePushSubscription,
  getNotificationsEnabled,
  getPushPublicKey,
  isPushConfigured,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationReadState,
  NotificationReferenceUnavailableError,
  setNotificationsEnabled,
  upsertPushSubscription,
} from '../notifications.js';
import {
  backfillMissingNotificationSchedules,
  detectOverdueNotificationSchedules,
  dismissAlarmSchedule,
  processDueNotificationSchedules,
  type ProcessNotificationSchedulesSummary,
  type ScheduleDiagnostics,
  snoozeAlarmSchedule,
} from '../notification-schedules.js';
import {
  processTaskSideEffects,
  type ProcessTaskSideEffectsSummary,
  type SideEffectDiagnostics,
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
  empty,
  type HandlerContext,
  type HandlerResult,
  getRequestMeta,
  json,
  methodNotAllowed,
} from './core.js';

const SIDE_EFFECT_PROCESS_DURATION_MS = 8000;
const CALENDAR_SYNC_DURATION_MS = 3000;
const MAX_CRON_RESPONSE_MS = 20000;
const DUE_SCHEDULE_LIMIT = 5;
const DUE_SCHEDULE_DURATION_MS = 8000;
const SIDE_EFFECT_LIMIT = 3;
const BACKFILL_LIMIT = 3;
const BACKFILL_DURATION_MS = 3000;
const CALENDAR_SYNC_LIMIT = 1;
const OVERDUE_LIMIT = 3;
const OVERDUE_DURATION_MS = 3000;
const CRON_DEADLINE_GUARD_MS = 500;
const DEFAULT_DB_HEALTH_QUERY_TIMEOUT_MS = 3000;
const DB_HEALTH_SLOW_THRESHOLD_MS = 1000;

type BackfillSummary = Awaited<ReturnType<typeof backfillMissingNotificationSchedules>> & {
  stoppedByTimeLimit?: boolean;
};
type CalendarSyncSummary = Awaited<ReturnType<typeof processPendingCalendarSyncs>>;
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
    schedulesPendingMs: number | null;
    schedulesDueMs: number | null;
    tasksPendingMs: number | null;
  };
  counts: {
    taskSideEffectsPending: number | null;
    taskSideEffectsDue: number | null;
    schedulesPending: number | null;
    schedulesDue: number | null;
    tasksPending: number | null;
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

const EMPTY_SCHEDULE_DIAGNOSTICS: ScheduleDiagnostics = {
  postgresNow: null,
  oldestPendingNotifyAt: null,
  duePendingCount: 0,
  futurePendingCount: 0,
  pendingByKind: {},
  dueByKind: {},
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
  };
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

export async function handleNotificationsCollection(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  if (request.method === 'GET') {
    try {
      const [notifications, enabled] = await Promise.all([
        listNotificationsForUser(sql, user.id),
        getNotificationsEnabled(sql, user.id),
      ]);
      return json(200, {
        notifications,
        enabled,
        pushConfigured: isPushConfigured(),
        pushPublicKey: getPushPublicKey(),
      });
    } catch (error) {
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
    try {
      const deletedCount = await clearNotificationsForUser(sql, user.id);
      logInfo('notifications_cleared', getRequestMeta(request, { userId: user.id, deletedCount }));
      return json(200, { deletedCount });
    } catch (error) {
      logError('notifications_clear_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao limpar notificações' });
    }
  }

  return methodNotAllowed();
}

export async function handleNotificationById(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  const id = resolveNotificationId(context);

  if (!id) {
    return json(400, { error: 'Notificação não encontrada' });
  }

  if (request.method !== 'PUT') return methodNotAllowed();

  const parsed = updateNotificationSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: 'Envie o campo "read" com true ou false.' });
  }

  try {
    const notification = await markNotificationReadState(sql, user.id, id, parsed.data.read);
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

  if (request.method !== 'POST') return methodNotAllowed();

  try {
    const updatedCount = await markAllNotificationsRead(sql, user.id);
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
      const enabled = await getNotificationsEnabled(sql, user.id);
      return json(200, {
        enabled,
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
      return json(400, { error: 'Envie o campo "enabled" com true ou false.' });
    }

    try {
      await setNotificationsEnabled(sql, user.id, parsed.data.enabled);
      logInfo('notification_settings_updated', getRequestMeta(request, { userId: user.id, enabled: parsed.data.enabled }));
      return json(200, { enabled: parsed.data.enabled });
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
    return json(400, { error: 'Alarme nÃ£o encontrado' });
  }

  const parsed = snoozeAlarmSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  try {
    const result = await snoozeAlarmSchedule(sql, auth.user.id, scheduleId, parsed.data.minutes);
    if (!result) return json(404, { error: 'Alarme nÃ£o encontrado' });
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
    schedulesPending: null,
    schedulesDue: null,
    tasksPending: null,
  };
  const db: CronDbHealth['db'] = {
    nowMs: null,
    taskSideEffectsPendingMs: null,
    taskSideEffectsDueMs: null,
    schedulesPendingMs: null,
    schedulesDueMs: null,
    tasksPendingMs: null,
  };

  const now = await measureQuery('db_now', () => sql`SELECT NOW() AS now`);
  steps.now = now.step;
  db.nowMs = now.step.durationMs;

  const shouldSkipCounts = !now.step.ok;
  if (shouldSkipCounts) {
    steps.taskSideEffectsPending = skippedStep();
    steps.taskSideEffectsDue = skippedStep();
    steps.schedulesPending = skippedStep();
    steps.schedulesDue = skippedStep();
    steps.tasksPending = skippedStep();
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
        AND cancelled_at IS NULL
    `,
  );
  steps.schedulesDue = schedulesDue.step;
  db.schedulesDueMs = schedulesDue.step.durationMs;
  counts.schedulesDue = schedulesDue.step.ok ? toCount(schedulesDue.rows[0]?.count) : null;

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
    pendingByKind: {},
    dueByKind: {},
    processingCount: 0,
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
    dueByKind: {},
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

function calendarSyncDisabledSummary(): CalendarSyncSummary & { skippedReason: string } {
  return {
    scanned: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    stoppedByTimeLimit: false,
    durationMs: 0,
    skippedReason: 'disabled_in_notification_cron',
  };
}

function maintenanceStageDisabledSummary(durationMs = 0) {
  return {
    backfilledSchedules: 0,
    durationMs,
    hasMore: false,
    stoppedByTimeLimit: false,
    skippedReason: 'disabled_in_notification_cron',
    backfillDiagnostics: {
      scannedTasks: 0,
      missingSchedules: 0,
      backfilledSchedules: 0,
      skippedReasons: { disabled_in_notification_cron: 1 },
    },
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
    return json(401, { error: 'NÃ£o autorizado' });
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

    if (dbHealth.slow) {
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
        skippedReason: 'db_health_slow',
      };
      const sideEffects = {
        ...fallbackSideEffects(0),
        hasMore: true,
        stoppedByTimeLimit: false,
        sideEffectDiagnostics: preliminarySideEffectDiagnostics,
        skippedReason: 'db_health_slow',
      };
      const backfill = {
        ...fallbackBackfill(0),
        hasMore: false,
        stoppedByTimeLimit: false,
        skippedReason: 'db_health_slow',
      };
      const calendarSync = calendarSyncDisabledSummary();
      const overdueDetection = {
        ...fallbackOverdueDetection(0),
        hasMore: false,
        stoppedByTimeLimit: false,
        skippedReason: 'db_health_slow',
      };

      logWarn('cron_notifications_skipped_by_db_health', getRequestMeta(request, {
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

    const scheduleBudgetMs = remainingBudgetMs(deadline, DUE_SCHEDULE_DURATION_MS);
    const result = await withTimeout(
      processDueNotificationSchedules(sql, DUE_SCHEDULE_LIMIT, scheduleBudgetMs, { ensureInfrastructure: false }),
      scheduleBudgetMs,
      fallbackSchedules(scheduleBudgetMs),
      'processDueNotificationSchedules',
    );
    const sideEffects = hasCronBudget(deadline)
      ? await (() => {
          const budgetMs = remainingBudgetMs(deadline, SIDE_EFFECT_PROCESS_DURATION_MS);
          return withTimeout(
            processTaskSideEffects(sql, SIDE_EFFECT_LIMIT, budgetMs, {
              ensureInfrastructure: false,
              notificationSchedulesOnly: true,
            }),
            budgetMs,
            fallbackSideEffects(budgetMs),
            'processTaskSideEffects',
          );
        })()
      : fallbackSideEffects();
    const maintenanceStagesEnabled = process.env.CRON_ENABLE_MAINTENANCE_STAGES === 'true';
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
      : maintenanceStageDisabledSummary();
    const calendarSync = process.env.CRON_ENABLE_CALENDAR_SYNC === 'true' && hasCronBudget(deadline)
      ? await (() => {
          const budgetMs = remainingBudgetMs(deadline, CALENDAR_SYNC_DURATION_MS);
          return withTimeout(
            processPendingCalendarSyncs(sql, CALENDAR_SYNC_LIMIT, budgetMs),
            budgetMs,
            fallbackCalendarSync(budgetMs),
            'processPendingCalendarSyncs',
          );
        })()
      : calendarSyncDisabledSummary();
    const overdueDetection = maintenanceStagesEnabled && hasCronBudget(deadline)
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
          skippedReason: 'disabled_in_notification_cron',
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
    };
    logInfo('cron_notifications_completed', getRequestMeta(request, {
      durationMs,
      stoppedByTimeLimit,
      hasMore,
      sideEffects,
      schedules,
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
      durationMs,
      stoppedByTimeLimit,
      hasMore,
      schedules,
      sideEffects,
      backfill,
      calendarSync,
      overdueDetection,
      dbHealth,
      scheduleDiagnostics: effectiveScheduleDiagnostics,
      sideEffectDiagnostics: effectiveSideEffectDiagnostics,
      backfillDiagnostics: backfill.backfillDiagnostics,
      ...result,
    });
  } catch (error) {
    logError('cron_notifications_failed', error, getRequestMeta(request));
    return json(500, { error: 'Erro ao gerar notificações agendadas' });
  }
}
