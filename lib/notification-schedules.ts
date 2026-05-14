import { format } from 'date-fns';
import {
  type NotificationScheduleKind,
  type NotificationScheduleStatus,
  type NotificationTone,
} from './contracts.js';
import type { SqlClient } from './handlers/core.js';
import { buildHolidayCalendar } from './holidays.js';
import { logError, logInfo, logWarn } from './logger.js';
import {
  createNotification,
  ensureNotificationsInfrastructure,
  getPushSendTimeoutMs,
  sendPushPayloadToUser,
} from './notifications.js';

const PRE_NOTICE_MINUTES = 15;
const FLOATING_LIFETIME_HOURS = 24;
const OVERDUE_LIFETIME_HOURS = 72;
const DEFAULT_FLOATING_INTERVAL_MINUTES = 60;
const PROCESS_LIMIT = 20;
const OVERDUE_TASK_SCAN_LIMIT = 10;
const MISSING_SCHEDULE_TASK_SCAN_LIMIT = 10;
const STUCK_PROCESSING_RECLAIM_LIMIT = 10;
const MAX_CRON_DURATION_MS = 25000;
const SCHEDULE_PROCESS_DURATION_MS = 15000;
const BACKFILL_DURATION_MS = 3000;
const INITIAL_FLOATING_SCHEDULE_LIMIT = 1;
const OVERDUE_SCHEDULES_PER_TASK_LIMIT = 1;
const QUIET_START_HOUR = 22;
const QUIET_END_HOUR = 7;
const SAO_PAULO_OFFSET = '-03:00';

interface TaskForScheduling {
  id: string;
  userId: string;
  title: string;
  description: string;
  dueDate: string | null;
  status: string;
  createdAt: string;
  alarmEnabled: boolean;
  reminderMode: 'timed' | 'floating';
  expiresAt: string | null;
  overdueSince: string | null;
  overdueExpiresAt: string | null;
  deletedAt: string | null;
  mutedUntil: string | null;
  suppressHolidayNotifications: boolean;
  floatingIntervalMinutes: number | null;
  notificationsEnabled?: boolean;
  stateCode: string | null;
  cityName: string | null;
  holidayRegionCode: string | null;
}

interface ScheduleRow {
  id: string;
  userId: string;
  taskId: string;
  kind: NotificationScheduleKind;
  notifyAt: string;
  title: string;
  message: string;
  tone: NotificationTone;
  dedupeKey: string;
  sequenceIndex: number | null;
  intervalMinutes: number | null;
}

export interface ScheduleDiagnostics {
  postgresNow: string | null;
  oldestPendingNotifyAt: string | null;
  duePendingCount: number;
  futurePendingCount: number;
  pendingByKind: Record<string, number>;
  dueByKind: Record<string, number>;
  processingCount: number;
  failedCount: number;
  cancelledCount: number;
}

export interface ProcessNotificationSchedulesSummary {
  detectedOverdueTasks: number;
  backfilledSchedules: number;
  reclaimedSchedules: number;
  fetchedSchedules: number;
  processedSchedules: number;
  sentSchedules: number;
  cancelledSchedules: number;
  rescheduledSchedules: number;
  failedSchedules: number;
  durationMs: number;
  hasMore: boolean;
  stoppedByTimeLimit: boolean;
  processed: number;
  sent: number;
  failed: number;
  cancelled: number;
  scheduleDiagnostics: ScheduleDiagnostics;
}

export interface BackfillDiagnostics {
  scannedTasks: number;
  missingSchedules: number;
  backfilledSchedules: number;
  skippedReasons: Record<string, number>;
}

export interface CleanupExpiredTaskSummary {
  floatingTasks: number;
  overdueTasks: number;
  cancelledSchedules: number;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapTask(row: Record<string, unknown>): TaskForScheduling {
  return {
    id: String(row.id),
    userId: String(row.userId),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    dueDate: toIso(row.dueDate),
    status: String(row.status ?? 'pending'),
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    alarmEnabled: Boolean(row.alarmEnabled),
    reminderMode: row.reminderMode === 'floating' ? 'floating' : 'timed',
    expiresAt: toIso(row.expiresAt),
    overdueSince: toIso(row.overdueSince),
    overdueExpiresAt: toIso(row.overdueExpiresAt),
    deletedAt: toIso(row.deletedAt),
    mutedUntil: toIso(row.mutedUntil),
    suppressHolidayNotifications: Boolean(row.suppressHolidayNotifications),
    floatingIntervalMinutes: typeof row.floatingIntervalMinutes === 'number'
      ? row.floatingIntervalMinutes
      : null,
    notificationsEnabled: row.notificationsEnabled === undefined ? undefined : Boolean(row.notificationsEnabled),
    stateCode: typeof row.stateCode === 'string' ? row.stateCode : null,
    cityName: typeof row.cityName === 'string' ? row.cityName : null,
    holidayRegionCode: typeof row.holidayRegionCode === 'string' ? row.holidayRegionCode : null,
  };
}

function mapSchedule(row: Record<string, unknown>): ScheduleRow {
  return {
    id: String(row.id),
    userId: String(row.userId),
    taskId: String(row.taskId),
    kind: String(row.kind) as NotificationScheduleKind,
    notifyAt: new Date(String(row.notifyAt)).toISOString(),
    title: String(row.title),
    message: String(row.message),
    tone: String(row.tone) as NotificationTone,
    dedupeKey: String(row.dedupeKey),
    sequenceIndex: typeof row.sequenceIndex === 'number' ? row.sequenceIndex : null,
    intervalMinutes: typeof row.intervalMinutes === 'number' ? row.intervalMinutes : null,
  };
}

function toCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapCountByKind(rows: Array<Record<string, unknown>>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [String(row.kind), toCount(row.count)]));
}

function isSchedulableStatus(status: string): boolean {
  return status === 'pending' || status === 'overdue';
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addHours(date: Date, hours: number): Date {
  return addMinutes(date, hours * 60);
}

function dedupeDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd-HH-mm');
}

function buildDedupeKey(userId: string, taskId: string, kind: NotificationScheduleKind, notifyAt: Date, sequenceIndex?: number) {
  if (kind === 'pre_notice') return `user:${userId}:task:${taskId}:pre-notice:${dedupeDateKey(notifyAt)}`;
  if (kind === 'notification') return `user:${userId}:task:${taskId}:notification:${dedupeDateKey(notifyAt)}`;
  if (kind === 'alarm') return `user:${userId}:task:${taskId}:alarm:${dedupeDateKey(notifyAt)}`;
  if (kind === 'floating_reminder') return `user:${userId}:task:${taskId}:floating:${dedupeDateKey(notifyAt)}`;
  return `user:${userId}:task:${taskId}:overdue:${sequenceIndex ?? 0}:${dedupeDateKey(notifyAt)}`;
}

function buildAlarmSnoozeDedupeKey(userId: string, taskId: string, notifyAt: Date) {
  return `user:${userId}:task:${taskId}:alarm-snooze:${notifyAt.getTime()}`;
}

function getSaoPauloParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function atSaoPauloHour(parts: ReturnType<typeof getSaoPauloParts>, hour: number) {
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, '0')}:00:00${SAO_PAULO_OFFSET}`);
}

export function adjustScheduleForQuietHours(kind: NotificationScheduleKind, notifyAt: Date): Date {
  if (kind !== 'floating_reminder' && kind !== 'overdue_reminder') return notifyAt;

  const parts = getSaoPauloParts(notifyAt);
  if (parts.hour >= QUIET_START_HOUR) {
    return addHours(atSaoPauloHour(parts, QUIET_END_HOUR), 24);
  }

  if (parts.hour < QUIET_END_HOUR) {
    return atSaoPauloHour(parts, QUIET_END_HOUR);
  }

  return notifyAt;
}

function getHolidayInfo(task: TaskForScheduling, notifyAt: Date) {
  if (!task.suppressHolidayNotifications) return null;

  const dateKey = notifyAt.toISOString().slice(0, 10);
  const calendar = buildHolidayCalendar({
    stateCode: task.stateCode,
    cityName: task.cityName,
    regionCode: task.holidayRegionCode,
  }, notifyAt);

  return calendar.allEntries.find((entry) => entry.date.slice(0, 10) === dateKey) ?? null;
}

function shouldCancelHolidaySchedule(kind: NotificationScheduleKind): boolean {
  return kind === 'pre_notice' || kind === 'notification';
}

function nextAllowedAfterHoliday(task: TaskForScheduling, kind: NotificationScheduleKind, notifyAt: Date): Date {
  let cursor = atSaoPauloHour(getSaoPauloParts(addHours(notifyAt, 24)), QUIET_END_HOUR);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    cursor = adjustScheduleForQuietHours(kind, cursor);
    if (!getHolidayInfo(task, cursor)) return cursor;
    cursor = addHours(cursor, 24);
  }
  return cursor;
}

function applyScheduleSuppression(task: TaskForScheduling, kind: NotificationScheduleKind, notifyAt: Date) {
  let adjusted = adjustScheduleForQuietHours(kind, notifyAt);
  const holiday = kind === 'alarm' ? null : getHolidayInfo(task, adjusted);
  if (!holiday) return { action: 'send' as const, notifyAt: adjusted, holiday: null };

  if (shouldCancelHolidaySchedule(kind)) {
    return { action: 'cancel' as const, notifyAt: adjusted, holiday };
  }

  adjusted = nextAllowedAfterHoliday(task, kind, adjusted);
  return { action: 'reschedule' as const, notifyAt: adjusted, holiday };
}

export function getOverdueIntervalMinutes(sequenceIndex: number): number {
  if (sequenceIndex <= 0) return 15;
  if (sequenceIndex === 1) return 30;

  let previousPrevious = 15;
  let previous = 30;
  for (let index = 2; index <= sequenceIndex; index += 1) {
    const next = Math.min(previousPrevious + previous, 360);
    previousPrevious = previous;
    previous = next;
  }

  return previous;
}

export function buildOverdueScheduleTimes(dueDate: Date, overdueExpiresAt: Date) {
  const times: Array<{ notifyAt: Date; sequenceIndex: number; intervalMinutes: number }> = [];
  let cursor = new Date(dueDate);
  for (let sequenceIndex = 0; sequenceIndex < 100; sequenceIndex += 1) {
    const intervalMinutes = getOverdueIntervalMinutes(sequenceIndex);
    cursor = addMinutes(cursor, intervalMinutes);
    if (cursor > overdueExpiresAt) break;
    times.push({ notifyAt: new Date(cursor), sequenceIndex, intervalMinutes });
  }
  return times;
}

export function formatOverdueDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const days = Math.floor(safeMinutes / (24 * 60));
  const hours = Math.floor((safeMinutes % (24 * 60)) / 60);
  const remainingMinutes = safeMinutes % 60;

  if (days > 0) return `${days} dia${days === 1 ? '' : 's'}${hours > 0 ? ` e ${hours}h` : ''}`;
  if (hours > 0 && remainingMinutes > 0) return `${hours}h${remainingMinutes}min`;
  if (hours > 0) return `${hours}h`;
  return `${remainingMinutes} minuto${remainingMinutes === 1 ? '' : 's'}`;
}

export async function ensureNotificationSchedulingInfrastructure(sql: SqlClient) {
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'tasks'::regclass
          AND conname = 'tasks_status_check'
          AND (
            pg_get_constraintdef(oid) NOT LIKE '%overdue%' OR
            pg_get_constraintdef(oid) NOT LIKE '%draft%' OR
            pg_get_constraintdef(oid) NOT LIKE '%inactive%' OR
            pg_get_constraintdef(oid) NOT LIKE '%cancelled%'
          )
      ) THEN
        ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'tasks'::regclass
          AND conname = 'tasks_status_check'
      ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT tasks_status_check
        CHECK (status IN ('pending', 'overdue', 'completed', 'draft', 'inactive', 'cancelled'));
      END IF;
    END $$;
  `;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS alarm_enabled BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_mode TEXT NOT NULL DEFAULT 'timed' CHECK (reminder_mode IN ('timed', 'floating'))`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_since TIMESTAMPTZ`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_expires_at TIMESTAMPTZ`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_source TEXT CHECK (completion_source IN ('user', 'system', 'calendar_sync'))`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS auto_deleted_reason TEXT`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS auto_deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS suppress_holiday_notifications BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS floating_interval_minutes INTEGER`;
  await sql`
    CREATE TABLE IF NOT EXISTS notification_schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('pre_notice', 'notification', 'alarm', 'floating_reminder', 'overdue_reminder')),
      notify_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      tone TEXT NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'success', 'warning', 'error')),
      dedupe_key TEXT NOT NULL,
      sequence_index INTEGER,
      interval_minutes INTEGER,
      processing_started_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      dismissed_at TIMESTAMPTZ,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_notification_schedules_due ON notification_schedules(status, notify_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_notification_schedules_task_status ON notification_schedules(task_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_notification_schedules_user_task ON notification_schedules(user_id, task_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_schedules_dedupe ON notification_schedules(user_id, dedupe_key)`;
  await sql`ALTER TABLE notification_schedules ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ`;
  await ensureNotificationsInfrastructure(sql);
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'notifications'::regclass
          AND conname = 'notifications_source_schedule_id_fkey'
      ) THEN
        ALTER TABLE notifications
        ADD CONSTRAINT notifications_source_schedule_id_fkey
        FOREIGN KEY (source_schedule_id) REFERENCES notification_schedules(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `;
}

async function fetchTaskForScheduling(sql: SqlClient, userId: string, taskId: string): Promise<TaskForScheduling | null> {
  const rows = await sql`
    SELECT
      tasks.id,
      tasks.user_id AS "userId",
      tasks.title,
      tasks.description,
      tasks.due_date AS "dueDate",
      tasks.status,
      tasks.created_at AS "createdAt",
      tasks.alarm_enabled AS "alarmEnabled",
      tasks.reminder_mode AS "reminderMode",
      tasks.expires_at AS "expiresAt",
      tasks.overdue_since AS "overdueSince",
      tasks.overdue_expires_at AS "overdueExpiresAt",
      tasks.deleted_at AS "deletedAt",
      tasks.muted_until AS "mutedUntil",
      tasks.suppress_holiday_notifications AS "suppressHolidayNotifications",
      tasks.floating_interval_minutes AS "floatingIntervalMinutes",
      users.notifications_enabled AS "notificationsEnabled",
      users.state_code AS "stateCode",
      users.city_name AS "cityName",
      users.holiday_region_code AS "holidayRegionCode"
    FROM tasks
    INNER JOIN users ON users.id = tasks.user_id
    WHERE tasks.id = ${taskId}
      AND tasks.user_id = ${userId}
    LIMIT 1
  `;
  return rows[0] ? mapTask(rows[0]) : null;
}

export async function cancelPendingNotificationSchedulesForTask(
  sql: SqlClient,
  taskId: string,
  userId?: string,
  options: {
    ensureInfrastructure?: boolean;
    reason?: string;
    caller?: string;
    taskStatus?: string | null;
  } = {},
) {
  if (options.ensureInfrastructure !== false) {
    await ensureNotificationSchedulingInfrastructure(sql);
  }
  const rows = userId
    ? await sql`
        UPDATE notification_schedules
        SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE task_id = ${taskId}
          AND user_id = ${userId}
          AND status IN ('pending', 'processing')
        RETURNING id
      `
    : await sql`
        UPDATE notification_schedules
        SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE task_id = ${taskId}
          AND status IN ('pending', 'processing')
        RETURNING id
      `;
  if (rows.length > 0) {
    logInfo('schedule_cancel_requested', {
      reason: options.reason ?? 'unspecified',
      caller: options.caller ?? 'unknown',
      taskId,
      userId,
      taskStatus: options.taskStatus ?? null,
      scheduleCount: rows.length,
    });
  }
  return rows.length;
}

async function insertSchedule(
  sql: SqlClient,
  task: TaskForScheduling,
  input: {
    kind: NotificationScheduleKind;
    notifyAt: Date;
    title: string;
    message: string;
    tone: NotificationTone;
    sequenceIndex?: number | null;
    intervalMinutes?: number | null;
    dedupeKey?: string;
  },
) {
  const rows = await sql`
    INSERT INTO notification_schedules (
      user_id,
      task_id,
      kind,
      notify_at,
      title,
      message,
      tone,
      dedupe_key,
      sequence_index,
      interval_minutes
    )
    VALUES (
      ${task.userId},
      ${task.id},
      ${input.kind},
      ${input.notifyAt},
      ${input.title},
      ${input.message},
      ${input.tone},
      ${input.dedupeKey ?? buildDedupeKey(task.userId, task.id, input.kind, input.notifyAt, input.sequenceIndex ?? undefined)},
      ${input.sequenceIndex ?? null},
      ${input.intervalMinutes ?? null}
    )
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

async function scheduleTimedTask(
  sql: SqlClient,
  task: TaskForScheduling,
  now: Date,
  options: { maxOverdueSchedules?: number; overdueNotBefore?: Date } = {},
) {
  if (!task.dueDate) return 0;
  const dueDate = new Date(task.dueDate);
  if (Number.isNaN(dueDate.getTime())) return 0;
  let created = 0;

  const preNoticeAt = addMinutes(dueDate, -PRE_NOTICE_MINUTES);
  if (preNoticeAt > now) {
    const preNotice = applyScheduleSuppression(task, 'pre_notice', preNoticeAt);
    if (preNotice.action === 'send' && preNotice.notifyAt < dueDate) {
      const inserted = await insertSchedule(sql, task, {
        kind: 'pre_notice',
        notifyAt: preNotice.notifyAt,
        title: 'Lembrete em 15 minutos',
        message: `"${task.title}" começa em breve.`,
        tone: 'info',
      });
      if (inserted) created += 1;
    } else if (preNotice.holiday) {
      logInfo('notification_schedule_holiday_cancelled', {
        userId: task.userId,
        taskId: task.id,
        kind: 'pre_notice',
        notifyAt: preNoticeAt.toISOString(),
        holidayName: preNotice.holiday.name,
        holidayScope: preNotice.holiday.scope,
      });
    }
  }

  if (dueDate >= now) {
    const kind: NotificationScheduleKind = task.alarmEnabled ? 'alarm' : 'notification';
    const adjusted = applyScheduleSuppression(task, kind, dueDate);
    if (kind === 'alarm' || adjusted.action === 'send') {
      const inserted = await insertSchedule(sql, task, {
        kind,
        notifyAt: adjusted.notifyAt,
        title: kind === 'alarm' ? 'Alarme' : 'Está na hora',
        message: kind === 'alarm'
          ? `"${task.title}"`
          : `"${task.title}" chegou ao horário definido.`,
        tone: kind === 'alarm' ? 'warning' : 'info',
      });
      if (inserted) created += 1;
    } else if (adjusted.holiday) {
      logInfo('notification_schedule_holiday_cancelled', {
        userId: task.userId,
        taskId: task.id,
        kind,
        notifyAt: dueDate.toISOString(),
        holidayName: adjusted.holiday.name,
        holidayScope: adjusted.holiday.scope,
      });
    }
    return created;
  }

  return markTaskOverdueAndSchedule(sql, task, dueDate, {
    maxOverdueSchedules: options.maxOverdueSchedules,
    overdueNotBefore: options.overdueNotBefore,
  });
}

async function scheduleFloatingTask(
  sql: SqlClient,
  task: TaskForScheduling,
  now: Date,
  options: { maxSchedules?: number } = {},
) {
  const createdAt = new Date(task.createdAt);
  const intervalMinutes = task.floatingIntervalMinutes ?? DEFAULT_FLOATING_INTERVAL_MINUTES;
  const expiresAt = task.expiresAt ? new Date(task.expiresAt) : addHours(createdAt, FLOATING_LIFETIME_HOURS);
  const maxSchedules = options.maxSchedules ?? INITIAL_FLOATING_SCHEDULE_LIMIT;
  let created = 0;

  await sql`
    UPDATE tasks
    SET
      reminder_mode = 'floating',
      expires_at = ${expiresAt},
      floating_interval_minutes = ${intervalMinutes}
    WHERE id = ${task.id}
      AND user_id = ${task.userId}
  `;

  let notifyAt = addMinutes(createdAt, intervalMinutes);
  let sequenceIndex = 0;
  while (notifyAt <= expiresAt && created < maxSchedules) {
    const adjusted = applyScheduleSuppression(task, 'floating_reminder', notifyAt);
    if (adjusted.action !== 'cancel' && adjusted.notifyAt > now && adjusted.notifyAt <= expiresAt) {
      const inserted = await insertSchedule(sql, task, {
        kind: 'floating_reminder',
        notifyAt: adjusted.notifyAt,
        title: 'Lembrete pendente',
        message: `"${task.title}" ainda está pendente.`,
        tone: 'info',
        sequenceIndex,
        intervalMinutes,
      });
      if (inserted) created += 1;
    }
    notifyAt = addMinutes(notifyAt, intervalMinutes);
    sequenceIndex += 1;
  }

  return created;
}

export async function syncTaskNotificationSchedules(sql: SqlClient, userId: string, taskId: string, options?: {
  floatingIntervalMinutes?: number | null;
  maxFloatingSchedules?: number;
  maxOverdueSchedules?: number;
  ensureInfrastructure?: boolean;
}) {
  if (options?.ensureInfrastructure !== false) {
    await ensureNotificationSchedulingInfrastructure(sql);
  }
  const task = await fetchTaskForScheduling(sql, userId, taskId);
  if (!task) return 0;

  const reminderMode = task.dueDate ? 'timed' : 'floating';
  const floatingIntervalMinutes = options?.floatingIntervalMinutes ?? task.floatingIntervalMinutes ?? DEFAULT_FLOATING_INTERVAL_MINUTES;
  await sql`
    UPDATE tasks
    SET
      reminder_mode = ${reminderMode},
      floating_interval_minutes = ${reminderMode === 'floating' ? floatingIntervalMinutes : null}
    WHERE id = ${task.id}
      AND user_id = ${task.userId}
  `;

  await cancelPendingNotificationSchedulesForTask(sql, task.id, task.userId, {
    ensureInfrastructure: false,
    reason: 'replace_task_schedules',
    caller: 'syncTaskNotificationSchedules',
    taskStatus: task.status,
  });

  if (!isSchedulableStatus(task.status) || task.deletedAt || task.status === 'cancelled') return 0;
  if (reminderMode === 'floating') {
    return scheduleFloatingTask(sql, { ...task, reminderMode, floatingIntervalMinutes }, new Date(), {
      maxSchedules: options?.maxFloatingSchedules ?? INITIAL_FLOATING_SCHEDULE_LIMIT,
    });
  }

  return scheduleTimedTask(sql, { ...task, reminderMode }, new Date(), {
    maxOverdueSchedules: options?.maxOverdueSchedules ?? OVERDUE_SCHEDULES_PER_TASK_LIMIT,
    overdueNotBefore: new Date(),
  });
}

export async function syncTaskNotificationSchedulesLightweight(
  sql: SqlClient,
  userId: string,
  taskId: string,
  options?: { floatingIntervalMinutes?: number | null; ensureInfrastructure?: boolean },
) {
  return syncTaskNotificationSchedules(sql, userId, taskId, {
    floatingIntervalMinutes: options?.floatingIntervalMinutes,
    maxFloatingSchedules: INITIAL_FLOATING_SCHEDULE_LIMIT,
    maxOverdueSchedules: OVERDUE_SCHEDULES_PER_TASK_LIMIT,
    ensureInfrastructure: options?.ensureInfrastructure,
  });
}

export async function scheduleOverdueRemindersForTask(
  sql: SqlClient,
  task: TaskForScheduling,
  options: { maxSchedules?: number; notBefore?: Date } = {},
) {
  if (!task.dueDate) return 0;
  const dueDate = new Date(task.dueDate);
  const overdueExpiresAt = task.overdueExpiresAt
    ? new Date(task.overdueExpiresAt)
    : addHours(dueDate, OVERDUE_LIFETIME_HOURS);
  const times = buildOverdueScheduleTimes(dueDate, overdueExpiresAt);
  const maxSchedules = options.maxSchedules ?? Number.POSITIVE_INFINITY;
  let created = 0;

  for (const item of times) {
    if (created >= maxSchedules) break;
    const adjusted = applyScheduleSuppression(task, 'overdue_reminder', item.notifyAt);
    if (adjusted.action === 'cancel' || adjusted.notifyAt > overdueExpiresAt) continue;
    if (options.notBefore && adjusted.notifyAt < options.notBefore) continue;
    const minutesOverdue = Math.max(0, Math.floor((adjusted.notifyAt.getTime() - dueDate.getTime()) / 60000));
    const inserted = await insertSchedule(sql, task, {
      kind: 'overdue_reminder',
      notifyAt: adjusted.notifyAt,
      title: 'Lembrete em atraso',
      message: `"${task.title}" está em atraso há ${formatOverdueDuration(minutesOverdue)}. Marque como concluído quando finalizar.`,
      tone: 'warning',
      sequenceIndex: item.sequenceIndex,
      intervalMinutes: item.intervalMinutes,
    });
    if (inserted) created += 1;
  }

  return created;
}

async function markTaskOverdueAndSchedule(
  sql: SqlClient,
  task: TaskForScheduling,
  dueDate: Date,
  options: { maxOverdueSchedules?: number; overdueNotBefore?: Date } = {},
) {
  if (task.reminderMode === 'floating' || !isSchedulableStatus(task.status)) return 0;
  const overdueExpiresAt = addHours(dueDate, OVERDUE_LIFETIME_HOURS);
  await sql`
    UPDATE tasks
    SET
      status = 'overdue',
      overdue_since = COALESCE(overdue_since, due_date),
      overdue_expires_at = COALESCE(overdue_expires_at, ${overdueExpiresAt})
    WHERE id = ${task.id}
      AND user_id = ${task.userId}
      AND deleted_at IS NULL
      AND status IN ('pending', 'overdue')
  `;

  return scheduleOverdueRemindersForTask(sql, {
    ...task,
    status: 'overdue',
    overdueSince: dueDate.toISOString(),
    overdueExpiresAt: overdueExpiresAt.toISOString(),
  }, {
    maxSchedules: options.maxOverdueSchedules,
    notBefore: options.overdueNotBefore,
  });
}

async function detectAndScheduleOverdueTasks(
  sql: SqlClient,
  limit: number,
  startedAt: number,
  maxDurationMs = MAX_CRON_DURATION_MS,
) {
  const rows = await sql`
    SELECT
      tasks.id,
      tasks.user_id AS "userId",
      tasks.title,
      tasks.description,
      tasks.due_date AS "dueDate",
      tasks.status,
      tasks.created_at AS "createdAt",
      tasks.alarm_enabled AS "alarmEnabled",
      tasks.reminder_mode AS "reminderMode",
      tasks.expires_at AS "expiresAt",
      tasks.overdue_since AS "overdueSince",
      tasks.overdue_expires_at AS "overdueExpiresAt",
      tasks.deleted_at AS "deletedAt",
      tasks.muted_until AS "mutedUntil",
      tasks.suppress_holiday_notifications AS "suppressHolidayNotifications",
      tasks.floating_interval_minutes AS "floatingIntervalMinutes",
      users.state_code AS "stateCode",
      users.city_name AS "cityName",
      users.holiday_region_code AS "holidayRegionCode"
    FROM tasks
    INNER JOIN users ON users.id = tasks.user_id
    WHERE tasks.deleted_at IS NULL
      AND (
        tasks.status = 'pending'
        OR (
          tasks.status = 'overdue'
          AND COALESCE(tasks.overdue_expires_at, tasks.due_date + INTERVAL '72 hours') > NOW()
          AND NOT EXISTS (
            SELECT 1
            FROM notification_schedules existing_overdue
            WHERE existing_overdue.user_id = tasks.user_id
              AND existing_overdue.task_id = tasks.id
              AND existing_overdue.kind = 'overdue_reminder'
              AND existing_overdue.status IN ('pending', 'processing')
              AND existing_overdue.notify_at >= NOW()
          )
        )
      )
      AND COALESCE(tasks.reminder_mode, 'timed') = 'timed'
      AND tasks.due_date IS NOT NULL
      AND tasks.due_date < NOW()
    ORDER BY tasks.due_date ASC
    LIMIT ${limit}
  `;

  let detected = 0;
  for (const row of rows) {
    if (Date.now() - startedAt >= maxDurationMs) {
      logWarn('notification_overdue_detection_stopped_by_time_limit', {
        detected,
        limit,
        durationMs: Date.now() - startedAt,
      });
      return { detected, hasMore: true };
    }

    const task = mapTask(row);
    if (!task.dueDate) continue;
    await markTaskOverdueAndSchedule(sql, task, new Date(task.dueDate), {
      maxOverdueSchedules: OVERDUE_SCHEDULES_PER_TASK_LIMIT,
      overdueNotBefore: new Date(),
    });
    detected += 1;
  }

  return { detected, hasMore: rows.length >= limit };
}

async function backfillMissingPendingTaskSchedules(
  sql: SqlClient,
  limit: number,
  startedAt: number,
  maxDurationMs = MAX_CRON_DURATION_MS,
) {
  const rows = await sql`
    SELECT
      tasks.id,
      tasks.user_id AS "userId"
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
    ORDER BY tasks.created_at ASC
    LIMIT ${limit + 1}
  `;

  const tasks = rows.slice(0, limit);
  let backfilled = 0;
  const skippedReasons: Record<string, number> = {};

  const addSkip = (reason: string) => {
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
  };

  for (const row of tasks) {
    if (Date.now() - startedAt >= maxDurationMs) {
      logWarn('notification_schedule_backfill_stopped_by_time_limit', {
        backfilled,
        limit,
        durationMs: Date.now() - startedAt,
      });
      addSkip('time_limit');
      return {
        backfilled,
        hasMore: true,
        diagnostics: {
          scannedTasks: tasks.length,
          missingSchedules: tasks.length,
          backfilledSchedules: backfilled,
          skippedReasons,
        },
      };
    }

    const created = await syncTaskNotificationSchedules(sql, String(row.userId), String(row.id), {
      maxFloatingSchedules: INITIAL_FLOATING_SCHEDULE_LIMIT,
      maxOverdueSchedules: OVERDUE_SCHEDULES_PER_TASK_LIMIT,
      ensureInfrastructure: false,
    });
    if (created > 0) {
      backfilled += created;
    } else {
      addSkip('no_schedule_created');
    }
  }

  return {
    backfilled,
    hasMore: rows.length > limit,
    diagnostics: {
      scannedTasks: tasks.length,
      missingSchedules: tasks.length,
      backfilledSchedules: backfilled,
      skippedReasons,
    },
  };
}

async function reclaimStuckProcessingSchedules(sql: SqlClient, limit: number) {
  const rows = await sql`
    WITH stuck AS (
      SELECT id
      FROM notification_schedules
      WHERE status = 'processing'
        AND processing_started_at < NOW() - INTERVAL '10 minutes'
      ORDER BY processing_started_at ASC NULLS FIRST, notify_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_schedules
    SET
      status = 'pending',
      processing_started_at = NULL,
      error_message = 'reclaimed_stuck_processing',
      updated_at = NOW()
    WHERE id IN (SELECT id FROM stuck)
    RETURNING id
  `;

  return rows.length;
}

async function claimDueSchedules(sql: SqlClient, limit: number) {
  const rows = await sql`
    WITH due AS (
      SELECT id
      FROM notification_schedules
      WHERE status = 'pending'
        AND notify_at <= NOW()
        AND sent_at IS NULL
        AND cancelled_at IS NULL
      ORDER BY notify_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_schedules ns
    SET
      status = 'processing',
      processing_started_at = NOW(),
      updated_at = NOW()
    FROM due
    WHERE ns.id = due.id
    RETURNING
      ns.id,
      ns.user_id AS "userId",
      ns.task_id AS "taskId",
      ns.kind,
      ns.notify_at AS "notifyAt",
      ns.title,
      ns.message,
      ns.tone,
      ns.dedupe_key AS "dedupeKey",
      ns.sequence_index AS "sequenceIndex",
      ns.interval_minutes AS "intervalMinutes"
  `;

  return rows.map(mapSchedule);
}

async function getScheduleDiagnostics(sql: SqlClient): Promise<ScheduleDiagnostics> {
  const [overviewRows, pendingKindRows, dueKindRows] = await Promise.all([
    sql`
      SELECT
        NOW() AS "postgresNow",
        MIN(notify_at) FILTER (WHERE status = 'pending') AS "oldestPendingNotifyAt",
        COUNT(*) FILTER (
          WHERE status = 'pending'
            AND notify_at <= NOW()
            AND sent_at IS NULL
            AND cancelled_at IS NULL
        ) AS "duePendingCount",
        COUNT(*) FILTER (
          WHERE status = 'pending'
            AND notify_at > NOW()
            AND sent_at IS NULL
            AND cancelled_at IS NULL
        ) AS "futurePendingCount",
        COUNT(*) FILTER (WHERE status = 'processing') AS "processingCount",
        COUNT(*) FILTER (WHERE status = 'failed') AS "failedCount",
        COUNT(*) FILTER (WHERE status = 'cancelled') AS "cancelledCount"
      FROM notification_schedules
    `,
    sql`
      SELECT kind, COUNT(*) AS count
      FROM notification_schedules
      WHERE status = 'pending'
      GROUP BY kind
      ORDER BY kind ASC
    `,
    sql`
      SELECT kind, COUNT(*) AS count
      FROM notification_schedules
      WHERE status = 'pending'
        AND notify_at <= NOW()
        AND sent_at IS NULL
        AND cancelled_at IS NULL
      GROUP BY kind
      ORDER BY kind ASC
    `,
  ]);

  const overview = overviewRows[0] ?? {};
  return {
    postgresNow: toIso(overview.postgresNow),
    oldestPendingNotifyAt: toIso(overview.oldestPendingNotifyAt),
    duePendingCount: toCount(overview.duePendingCount),
    futurePendingCount: toCount(overview.futurePendingCount),
    pendingByKind: mapCountByKind(pendingKindRows),
    dueByKind: mapCountByKind(dueKindRows),
    processingCount: toCount(overview.processingCount),
    failedCount: toCount(overview.failedCount),
    cancelledCount: toCount(overview.cancelledCount),
  };
}

async function updateScheduleStatus(sql: SqlClient, scheduleId: string, status: NotificationScheduleStatus, errorMessage?: string) {
  await sql`
    UPDATE notification_schedules
    SET
      status = ${status},
      sent_at = CASE WHEN ${status} = 'sent' THEN NOW() ELSE sent_at END,
      failed_at = CASE WHEN ${status} = 'failed' THEN NOW() ELSE failed_at END,
      cancelled_at = CASE WHEN ${status} = 'cancelled' THEN NOW() ELSE cancelled_at END,
      processing_started_at = CASE WHEN ${status} = 'processing' THEN processing_started_at ELSE NULL END,
      error_message = ${errorMessage ?? null},
      updated_at = NOW()
    WHERE id = ${scheduleId}
  `;
}

async function rescheduleSchedule(sql: SqlClient, scheduleId: string, notifyAt: Date, reason: string) {
  await sql`
    UPDATE notification_schedules
    SET
      status = 'pending',
      notify_at = ${notifyAt},
      processing_started_at = NULL,
      error_message = ${reason},
      updated_at = NOW()
    WHERE id = ${scheduleId}
  `;
}

async function fetchTaskForSchedule(sql: SqlClient, schedule: ScheduleRow): Promise<TaskForScheduling | null> {
  return fetchTaskForScheduling(sql, schedule.userId, schedule.taskId);
}

async function scheduleNextFloatingReminder(sql: SqlClient, schedule: ScheduleRow, task: TaskForScheduling) {
  const intervalMinutes = schedule.intervalMinutes ?? task.floatingIntervalMinutes ?? DEFAULT_FLOATING_INTERVAL_MINUTES;
  const createdAt = new Date(task.createdAt);
  const expiresAt = task.expiresAt ? new Date(task.expiresAt) : addHours(createdAt, FLOATING_LIFETIME_HOURS);
  const now = new Date();
  let notifyAt = addMinutes(new Date(schedule.notifyAt), intervalMinutes);
  let sequenceIndex = (schedule.sequenceIndex ?? -1) + 1;

  for (let attempt = 0; attempt < 100 && notifyAt <= expiresAt; attempt += 1) {
    const adjusted = applyScheduleSuppression(task, 'floating_reminder', notifyAt);
    if (adjusted.action !== 'cancel' && adjusted.notifyAt > now && adjusted.notifyAt <= expiresAt) {
      const inserted = await insertSchedule(sql, task, {
        kind: 'floating_reminder',
        notifyAt: adjusted.notifyAt,
        title: 'Lembrete pendente',
        message: `"${task.title}" ainda estÃ¡ pendente.`,
        tone: 'info',
        sequenceIndex,
        intervalMinutes,
      });
      if (inserted) return true;
    }

    notifyAt = addMinutes(notifyAt, intervalMinutes);
    sequenceIndex += 1;
  }

  return false;
}

async function scheduleNextOverdueReminder(sql: SqlClient, schedule: ScheduleRow, task: TaskForScheduling) {
  if (!task.dueDate) return false;

  const dueDate = new Date(task.dueDate);
  const overdueExpiresAt = task.overdueExpiresAt
    ? new Date(task.overdueExpiresAt)
    : addHours(dueDate, OVERDUE_LIFETIME_HOURS);
  const currentSequenceIndex = schedule.sequenceIndex ?? -1;
  const now = new Date();

  for (const item of buildOverdueScheduleTimes(dueDate, overdueExpiresAt)) {
    if (item.sequenceIndex <= currentSequenceIndex) continue;

    const adjusted = applyScheduleSuppression(task, 'overdue_reminder', item.notifyAt);
    if (adjusted.action === 'cancel' || adjusted.notifyAt > overdueExpiresAt || adjusted.notifyAt < now) continue;

    const minutesOverdue = Math.max(0, Math.floor((adjusted.notifyAt.getTime() - dueDate.getTime()) / 60000));
    const inserted = await insertSchedule(sql, task, {
      kind: 'overdue_reminder',
      notifyAt: adjusted.notifyAt,
      title: 'Lembrete em atraso',
      message: `"${task.title}" estÃ¡ em atraso hÃ¡ ${formatOverdueDuration(minutesOverdue)}. Marque como concluÃ­do quando finalizar.`,
      tone: 'warning',
      sequenceIndex: item.sequenceIndex,
      intervalMinutes: item.intervalMinutes,
    });
    if (inserted) return true;
  }

  return false;
}

async function scheduleNextIncrementalReminder(sql: SqlClient, schedule: ScheduleRow, task: TaskForScheduling) {
  if (schedule.kind === 'floating_reminder') {
    return scheduleNextFloatingReminder(sql, schedule, task);
  }

  if (schedule.kind === 'overdue_reminder') {
    return scheduleNextOverdueReminder(sql, schedule, task);
  }

  return false;
}

async function sendAlarmSchedule(sql: SqlClient, schedule: ScheduleRow, task: TaskForScheduling) {
  const result = await createNotification(sql, {
    userId: schedule.userId,
    title: schedule.title,
    message: schedule.message,
    tone: schedule.tone,
    target: { type: 'task', taskId: schedule.taskId },
    dedupeKey: schedule.dedupeKey,
    sourceScheduleId: schedule.id,
    kind: 'alarm',
    sendPush: false,
  });

  if (!result.created) {
    logInfo('notification_schedule_deduplicated', {
      userId: schedule.userId,
      taskId: schedule.taskId,
      scheduleId: schedule.id,
      kind: schedule.kind,
      dedupeKey: schedule.dedupeKey,
      notificationId: result.notification.id,
    });
    return false;
  }

  await updateScheduleStatus(sql, schedule.id, 'sent');
  await sendSchedulePush(sql, schedule, task, {
    title: schedule.title,
    body: schedule.message,
    tag: schedule.dedupeKey,
    icon: '/icon.png',
    badge: '/icon.png',
    data: {
      id: result.notification.id,
      notificationId: result.notification.id,
      kind: 'alarm',
      type: 'alarm',
      scheduleId: schedule.id,
      sourceScheduleId: schedule.id,
      dedupeKey: schedule.dedupeKey,
      taskId: schedule.taskId,
      taskTitle: task.title,
      dueDate: schedule.notifyAt,
      path: `/?notificationTarget=task&taskId=${encodeURIComponent(schedule.taskId)}`,
      target: { type: 'task', taskId: schedule.taskId },
      tone: schedule.tone,
    },
  }, result.notification.id);

  return true;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function sendSchedulePush(
  sql: SqlClient,
  schedule: ScheduleRow,
  task: TaskForScheduling,
  payload: unknown,
  notificationId: string,
) {
  const timeoutMs = getPushSendTimeoutMs();
  try {
    await withTimeout(
      sendPushPayloadToUser(sql, schedule.userId, payload, notificationId),
      timeoutMs,
      'schedule_push_timeout',
    );
  } catch (error) {
    logError('notification_schedule_push_failed', error, {
      userId: schedule.userId,
      taskId: schedule.taskId,
      scheduleId: schedule.id,
      notificationId,
      kind: schedule.kind,
      timeoutMs,
      taskTitle: task.title,
    });
  }
}

async function processSingleSchedule(sql: SqlClient, schedule: ScheduleRow) {
  const task = await fetchTaskForSchedule(sql, schedule);
  if (!task || task.deletedAt || !isSchedulableStatus(task.status)) {
    const reason = !task
      ? 'task_not_found'
      : task.deletedAt
        ? 'task_deleted'
        : `task_status_${task.status}`;
    logInfo('schedule_cancel_requested', {
      reason,
      caller: 'processSingleSchedule',
      taskId: schedule.taskId,
      userId: schedule.userId,
      taskStatus: task?.status ?? null,
      scheduleCount: 1,
      scheduleId: schedule.id,
      kind: schedule.kind,
    });
    await updateScheduleStatus(sql, schedule.id, 'cancelled', reason);
    return 'cancelled' as const;
  }

  if (
    (schedule.kind === 'floating_reminder' || schedule.kind === 'overdue_reminder') &&
    task.mutedUntil &&
    new Date(task.mutedUntil) > new Date()
  ) {
    const notifyAt = adjustScheduleForQuietHours(schedule.kind, new Date(task.mutedUntil));
    await rescheduleSchedule(sql, schedule.id, notifyAt, 'muted_until');
    return 'rescheduled' as const;
  }

  const suppression = applyScheduleSuppression(task, schedule.kind, new Date(schedule.notifyAt));
  if (suppression.action === 'cancel') {
    if (suppression.holiday) {
      logInfo('notification_schedule_holiday_cancelled', {
        userId: schedule.userId,
        taskId: schedule.taskId,
        scheduleId: schedule.id,
        kind: schedule.kind,
        notifyAt: schedule.notifyAt,
        holidayName: suppression.holiday.name,
        holidayScope: suppression.holiday.scope,
      });
    }
    await updateScheduleStatus(sql, schedule.id, 'cancelled', 'holiday');
    return 'cancelled' as const;
  }

  if (suppression.notifyAt.getTime() > Date.now() + 1000) {
    if (suppression.holiday) {
      logInfo('notification_schedule_holiday_rescheduled', {
        userId: schedule.userId,
        taskId: schedule.taskId,
        scheduleId: schedule.id,
        kind: schedule.kind,
        notifyAt: schedule.notifyAt,
        nextNotifyAt: suppression.notifyAt.toISOString(),
        holidayName: suppression.holiday.name,
        holidayScope: suppression.holiday.scope,
      });
    }
    await rescheduleSchedule(sql, schedule.id, suppression.notifyAt, suppression.holiday ? 'holiday' : 'quiet_hours');
    return 'rescheduled' as const;
  }

  if (schedule.kind === 'alarm') {
    await sendAlarmSchedule(sql, schedule, task);
  } else {
    const result = await createNotification(sql, {
      userId: schedule.userId,
      title: schedule.title,
      message: schedule.message,
      tone: schedule.tone,
      target: { type: 'task', taskId: schedule.taskId },
      dedupeKey: schedule.dedupeKey,
      sourceScheduleId: schedule.id,
      kind: schedule.kind,
      sendPush: false,
    });

    if (!result.created) {
      logInfo('notification_schedule_deduplicated', {
        userId: schedule.userId,
        taskId: schedule.taskId,
        scheduleId: schedule.id,
        kind: schedule.kind,
        dedupeKey: schedule.dedupeKey,
        notificationId: result.notification.id,
      });
    } else {
      await updateScheduleStatus(sql, schedule.id, 'sent');
      await sendSchedulePush(sql, schedule, task, {
        title: schedule.title,
        body: schedule.message,
        tag: schedule.dedupeKey,
        icon: '/icon.png',
        badge: '/icon.png',
        data: {
          id: result.notification.id,
          notificationId: result.notification.id,
          kind: schedule.kind,
          type: schedule.kind,
          scheduleId: schedule.id,
          sourceScheduleId: schedule.id,
          dedupeKey: schedule.dedupeKey,
          taskId: schedule.taskId,
          taskTitle: task.title,
          dueDate: schedule.notifyAt,
          path: `/?notificationTarget=task&taskId=${encodeURIComponent(schedule.taskId)}`,
          target: { type: 'task', taskId: schedule.taskId },
          tone: schedule.tone,
        },
      }, result.notification.id);
      if (schedule.kind === 'floating_reminder' || schedule.kind === 'overdue_reminder') {
        await scheduleNextIncrementalReminder(sql, schedule, task).catch((error) => {
          logError('notification_schedule_incremental_follow_up_failed', error, {
            userId: schedule.userId,
            taskId: schedule.taskId,
            scheduleId: schedule.id,
            kind: schedule.kind,
          });
        });
      }
      return 'sent' as const;
    }
  }

  await updateScheduleStatus(sql, schedule.id, 'sent');
  if (schedule.kind === 'floating_reminder' || schedule.kind === 'overdue_reminder') {
    await scheduleNextIncrementalReminder(sql, schedule, task).catch((error) => {
      logError('notification_schedule_incremental_follow_up_failed', error, {
        userId: schedule.userId,
        taskId: schedule.taskId,
        scheduleId: schedule.id,
        kind: schedule.kind,
      });
    });
  }
  return 'sent' as const;
}

function createScheduleSummary(input: {
  diagnostics: ScheduleDiagnostics;
  reclaimedSchedules?: number;
  fetchedSchedules?: number;
  durationMs?: number;
  hasMore?: boolean;
  stoppedByTimeLimit?: boolean;
}): ProcessNotificationSchedulesSummary {
  return {
    detectedOverdueTasks: 0,
    backfilledSchedules: 0,
    reclaimedSchedules: input.reclaimedSchedules ?? 0,
    fetchedSchedules: input.fetchedSchedules ?? 0,
    processedSchedules: 0,
    sentSchedules: 0,
    cancelledSchedules: 0,
    rescheduledSchedules: 0,
    failedSchedules: 0,
    durationMs: input.durationMs ?? 0,
    hasMore: input.hasMore ?? false,
    stoppedByTimeLimit: input.stoppedByTimeLimit ?? false,
    processed: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    scheduleDiagnostics: input.diagnostics,
  };
}

function finalizeScheduleSummary(summary: ProcessNotificationSchedulesSummary, startedAt: number) {
  summary.durationMs = Date.now() - startedAt;
  summary.processed = summary.processedSchedules;
  summary.sent = summary.sentSchedules;
  summary.failed = summary.failedSchedules;
  summary.cancelled = summary.cancelledSchedules;
  return summary;
}

export async function processDueNotificationSchedules(
  sql: SqlClient,
  limit = PROCESS_LIMIT,
  maxDurationMs = SCHEDULE_PROCESS_DURATION_MS,
  options: { ensureInfrastructure?: boolean } = {},
): Promise<ProcessNotificationSchedulesSummary> {
  const startedAt = Date.now();
  const processLimit = Math.min(Math.max(1, limit), PROCESS_LIMIT);
  logInfo('cron_notifications_started', {
    processLimit,
    stuckProcessingReclaimLimit: STUCK_PROCESSING_RECLAIM_LIMIT,
    maxDurationMs,
  });

  if (options.ensureInfrastructure !== false) {
    await ensureNotificationSchedulingInfrastructure(sql);
  }
  const reclaimedSchedules = await reclaimStuckProcessingSchedules(sql, STUCK_PROCESSING_RECLAIM_LIMIT);
  const scheduleDiagnostics = await getScheduleDiagnostics(sql);
  const outOfTimeBeforeClaim = Date.now() - startedAt >= maxDurationMs;
  if (outOfTimeBeforeClaim) {
    logWarn('cron_notifications_claim_skipped_by_time_limit', {
      durationMs: Date.now() - startedAt,
      maxDurationMs,
      reclaimedSchedules,
      scheduleDiagnostics,
    });
  }

  const schedules = outOfTimeBeforeClaim
    ? []
    : await claimDueSchedules(sql, processLimit);
  const summary = createScheduleSummary({
    diagnostics: scheduleDiagnostics,
    reclaimedSchedules,
    fetchedSchedules: schedules.length,
    hasMore: outOfTimeBeforeClaim || reclaimedSchedules >= STUCK_PROCESSING_RECLAIM_LIMIT || schedules.length >= processLimit,
    stoppedByTimeLimit: outOfTimeBeforeClaim,
  });

  logInfo('cron_notifications_schedules_claimed', {
    fetchedSchedules: schedules.length,
    reclaimedSchedules,
    hasMore: summary.hasMore,
    scheduleDiagnostics,
  });

  if (scheduleDiagnostics.duePendingCount > 0 && schedules.length === 0) {
    logError('notification_schedule_due_but_not_fetched', undefined, {
      scheduleDiagnostics,
      processLimit,
      reclaimedSchedules,
      outOfTimeBeforeClaim,
    });
  }

  for (const schedule of schedules) {
    if (Date.now() - startedAt >= maxDurationMs) {
      summary.hasMore = true;
      summary.stoppedByTimeLimit = true;
      logWarn('cron_notifications_stopped_by_time_limit', {
        processedSchedules: summary.processedSchedules,
        fetchedSchedules: schedules.length,
        durationMs: Date.now() - startedAt,
        maxDurationMs,
      });
      break;
    }

    try {
      const result = await processSingleSchedule(sql, schedule);
      summary.processedSchedules += 1;
      if (result === 'sent') summary.sentSchedules += 1;
      if (result === 'cancelled') summary.cancelledSchedules += 1;
      if (result === 'rescheduled') summary.rescheduledSchedules += 1;
    } catch (error) {
      summary.processedSchedules += 1;
      summary.failedSchedules += 1;
      await updateScheduleStatus(sql, schedule.id, 'failed', error instanceof Error ? error.message : 'Erro desconhecido');
      logError('notification_schedule_failed', error, {
        userId: schedule.userId,
        taskId: schedule.taskId,
        scheduleId: schedule.id,
        kind: schedule.kind,
      });
    }
  }

  finalizeScheduleSummary(summary, startedAt);
  logInfo('cron_notifications_finished', {
    detectedOverdueTasks: summary.detectedOverdueTasks,
    backfilledSchedules: summary.backfilledSchedules,
    reclaimedSchedules: summary.reclaimedSchedules,
    fetchedSchedules: summary.fetchedSchedules,
    processedSchedules: summary.processedSchedules,
    sentSchedules: summary.sentSchedules,
    cancelledSchedules: summary.cancelledSchedules,
    rescheduledSchedules: summary.rescheduledSchedules,
    failedSchedules: summary.failedSchedules,
    durationMs: summary.durationMs,
    hasMore: summary.hasMore,
    stoppedByTimeLimit: summary.stoppedByTimeLimit,
    scheduleDiagnostics: summary.scheduleDiagnostics,
  });

  return summary;
}

export async function backfillMissingNotificationSchedules(
  sql: SqlClient,
  limit = MISSING_SCHEDULE_TASK_SCAN_LIMIT,
  maxDurationMs = BACKFILL_DURATION_MS,
  options: { ensureInfrastructure?: boolean } = {},
) {
  const startedAt = Date.now();
  if (options.ensureInfrastructure !== false) {
    await ensureNotificationSchedulingInfrastructure(sql);
  }
  const backfill = await backfillMissingPendingTaskSchedules(sql, limit, startedAt, maxDurationMs);
  return {
    backfilledSchedules: backfill.backfilled,
    durationMs: Date.now() - startedAt,
    hasMore: backfill.hasMore,
    backfillDiagnostics: backfill.diagnostics,
  };
}

export async function detectOverdueNotificationSchedules(
  sql: SqlClient,
  limit = OVERDUE_TASK_SCAN_LIMIT,
  maxDurationMs = BACKFILL_DURATION_MS,
  options: { ensureInfrastructure?: boolean } = {},
) {
  const startedAt = Date.now();
  if (options.ensureInfrastructure !== false) {
    await ensureNotificationSchedulingInfrastructure(sql);
  }
  const overdueDetection = await detectAndScheduleOverdueTasks(sql, limit, startedAt, maxDurationMs);
  return {
    detectedOverdueTasks: overdueDetection.detected,
    durationMs: Date.now() - startedAt,
    hasMore: overdueDetection.hasMore,
  };
}

export async function processNotificationSchedules(sql: SqlClient, limit = PROCESS_LIMIT): Promise<ProcessNotificationSchedulesSummary> {
  const startedAt = Date.now();
  const dueSummary = await processDueNotificationSchedules(sql, limit, SCHEDULE_PROCESS_DURATION_MS);
  const backfill = await backfillMissingNotificationSchedules(sql, MISSING_SCHEDULE_TASK_SCAN_LIMIT, BACKFILL_DURATION_MS);
  const overdueDetection = await detectOverdueNotificationSchedules(sql, OVERDUE_TASK_SCAN_LIMIT, BACKFILL_DURATION_MS);

  dueSummary.backfilledSchedules = backfill.backfilledSchedules;
  dueSummary.detectedOverdueTasks = overdueDetection.detectedOverdueTasks;
  dueSummary.durationMs = Date.now() - startedAt;
  dueSummary.hasMore = dueSummary.hasMore || backfill.hasMore || overdueDetection.hasMore;
  return dueSummary;
}

export async function snoozeAlarmSchedule(sql: SqlClient, userId: string, scheduleId: string, minutes: number) {
  await ensureNotificationSchedulingInfrastructure(sql);
  const claimedRows = await sql`
    UPDATE notification_schedules
    SET
      status = 'sent',
      sent_at = COALESCE(sent_at, NOW()),
      dismissed_at = NOW(),
      updated_at = NOW()
    WHERE id = ${scheduleId}
      AND user_id = ${userId}
      AND kind = 'alarm'
      AND dismissed_at IS NULL
      AND status <> 'cancelled'
    RETURNING task_id AS "taskId", title, message, tone
  `;

  const claimed = claimedRows[0];
  if (!claimed) return null;

  const rows = await sql`
    SELECT
      tasks.id AS "taskId",
      tasks.title AS "taskTitle"
    FROM tasks
    WHERE tasks.id = ${String(claimed.taskId)}
      AND tasks.user_id = ${userId}
      AND tasks.deleted_at IS NULL
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;
  const notifyAt = addMinutes(new Date(), minutes);
  const task: TaskForScheduling = {
    id: String(row.taskId ?? claimed.taskId),
    userId,
    title: String(row.taskTitle ?? ''),
    description: '',
    dueDate: null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    alarmEnabled: true,
    reminderMode: 'timed',
    expiresAt: null,
    overdueSince: null,
    overdueExpiresAt: null,
    deletedAt: null,
    mutedUntil: null,
    suppressHolidayNotifications: false,
    floatingIntervalMinutes: null,
    stateCode: null,
    cityName: null,
    holidayRegionCode: null,
  };

  await insertSchedule(sql, task, {
    kind: 'alarm',
    notifyAt,
    title: 'Alarme',
    message: `"${task.title}"`,
    tone: 'warning',
    dedupeKey: buildAlarmSnoozeDedupeKey(userId, task.id, notifyAt),
  });

  logInfo('alarm_snoozed', { userId, taskId: task.id, scheduleId, minutes, notifyAt: notifyAt.toISOString() });
  return { taskId: task.id, notifyAt: notifyAt.toISOString() };
}

export async function dismissAlarmSchedule(sql: SqlClient, userId: string, scheduleId: string) {
  await ensureNotificationSchedulingInfrastructure(sql);
  const rows = await sql`
    UPDATE notification_schedules
    SET
      status = 'sent',
      sent_at = COALESCE(sent_at, NOW()),
      dismissed_at = COALESCE(dismissed_at, NOW()),
      updated_at = NOW()
    WHERE id = ${scheduleId}
      AND user_id = ${userId}
      AND kind = 'alarm'
      AND status <> 'cancelled'
    RETURNING task_id AS "taskId", dismissed_at AS "dismissedAt"
  `;

  const row = rows[0];
  if (!row) return null;

  logInfo('alarm_dismissed', {
    userId,
    taskId: String(row.taskId),
    scheduleId,
  });

  return {
    taskId: String(row.taskId),
    dismissedAt: new Date(String(row.dismissedAt)).toISOString(),
  };
}

export async function cleanupExpiredFloatingTasks(sql: SqlClient) {
  await ensureNotificationSchedulingInfrastructure(sql);
  const rows = await sql`
    UPDATE tasks
    SET
      status = 'cancelled',
      deleted_at = NOW(),
      auto_deleted_at = NOW(),
      auto_deleted_reason = 'floating_expired'
    WHERE reminder_mode = 'floating'
      AND expires_at <= NOW()
      AND deleted_at IS NULL
      AND status IN ('pending', 'overdue')
    RETURNING id, user_id AS "userId"
  `;

  let cancelledSchedules = 0;
  for (const row of rows) {
    cancelledSchedules += await cancelPendingNotificationSchedulesForTask(sql, String(row.id), String(row.userId), {
      reason: 'floating_expired',
      caller: 'cleanupExpiredFloatingTasks',
      taskStatus: 'cancelled',
    });
  }

  return { tasks: rows.length, cancelledSchedules };
}

export async function cleanupExpiredOverdueTasks(sql: SqlClient) {
  await ensureNotificationSchedulingInfrastructure(sql);
  const rows = await sql`
    UPDATE tasks
    SET
      status = 'cancelled',
      deleted_at = NOW(),
      auto_deleted_at = NOW(),
      auto_deleted_reason = 'overdue_expired'
    WHERE reminder_mode = 'timed'
      AND overdue_expires_at <= NOW()
      AND deleted_at IS NULL
      AND status IN ('pending', 'overdue')
    RETURNING id, user_id AS "userId"
  `;

  let cancelledSchedules = 0;
  for (const row of rows) {
    cancelledSchedules += await cancelPendingNotificationSchedulesForTask(sql, String(row.id), String(row.userId), {
      reason: 'overdue_expired',
      caller: 'cleanupExpiredOverdueTasks',
      taskStatus: 'cancelled',
    });
  }

  return { tasks: rows.length, cancelledSchedules };
}

export async function cleanupExpiredNotificationTasks(sql: SqlClient): Promise<CleanupExpiredTaskSummary> {
  const [floating, overdue] = await Promise.all([
    cleanupExpiredFloatingTasks(sql),
    cleanupExpiredOverdueTasks(sql),
  ]);

  logWarn('notification_tasks_auto_cleanup_completed', {
    floatingTasks: floating.tasks,
    overdueTasks: overdue.tasks,
  });

  return {
    floatingTasks: floating.tasks,
    overdueTasks: overdue.tasks,
    cancelledSchedules: floating.cancelledSchedules + overdue.cancelledSchedules,
  };
}
