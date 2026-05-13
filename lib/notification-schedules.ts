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
  sendPushPayloadToUser,
} from './notifications.js';

const PRE_NOTICE_MINUTES = 15;
const FLOATING_LIFETIME_HOURS = 24;
const OVERDUE_LIFETIME_HOURS = 72;
const DEFAULT_FLOATING_INTERVAL_MINUTES = 60;
const MAX_CRON_BATCH_SIZE = 100;
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

export interface ProcessNotificationSchedulesSummary {
  detectedOverdueTasks: number;
  processedSchedules: number;
  sentSchedules: number;
  cancelledSchedules: number;
  rescheduledSchedules: number;
  failedSchedules: number;
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

export async function cancelPendingNotificationSchedulesForTask(sql: SqlClient, taskId: string, userId?: string) {
  await ensureNotificationSchedulingInfrastructure(sql);
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
  await sql`
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
  `;
}

async function scheduleTimedTask(sql: SqlClient, task: TaskForScheduling, now: Date) {
  if (!task.dueDate) return;
  const dueDate = new Date(task.dueDate);
  if (Number.isNaN(dueDate.getTime())) return;

  const preNoticeAt = addMinutes(dueDate, -PRE_NOTICE_MINUTES);
  if (preNoticeAt > now) {
    const preNotice = applyScheduleSuppression(task, 'pre_notice', preNoticeAt);
    if (preNotice.action === 'send' && preNotice.notifyAt < dueDate) {
      await insertSchedule(sql, task, {
        kind: 'pre_notice',
        notifyAt: preNotice.notifyAt,
        title: 'Lembrete em 15 minutos',
        message: `"${task.title}" começa em breve.`,
        tone: 'info',
      });
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
      await insertSchedule(sql, task, {
        kind,
        notifyAt: adjusted.notifyAt,
        title: kind === 'alarm' ? 'Alarme' : 'Está na hora',
        message: kind === 'alarm'
          ? `"${task.title}"`
          : `"${task.title}" chegou ao horário definido.`,
        tone: kind === 'alarm' ? 'warning' : 'info',
      });
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
    return;
  }

  await markTaskOverdueAndSchedule(sql, task, dueDate);
}

async function scheduleFloatingTask(sql: SqlClient, task: TaskForScheduling, now: Date) {
  const createdAt = new Date(task.createdAt);
  const intervalMinutes = task.floatingIntervalMinutes ?? DEFAULT_FLOATING_INTERVAL_MINUTES;
  const expiresAt = task.expiresAt ? new Date(task.expiresAt) : addHours(createdAt, FLOATING_LIFETIME_HOURS);

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
  while (notifyAt <= expiresAt) {
    const adjusted = applyScheduleSuppression(task, 'floating_reminder', notifyAt);
    if (adjusted.action !== 'cancel' && adjusted.notifyAt > now && adjusted.notifyAt <= expiresAt) {
      await insertSchedule(sql, task, {
        kind: 'floating_reminder',
        notifyAt: adjusted.notifyAt,
        title: 'Lembrete pendente',
        message: `"${task.title}" ainda está pendente.`,
        tone: 'info',
        sequenceIndex,
        intervalMinutes,
      });
    }
    notifyAt = addMinutes(notifyAt, intervalMinutes);
    sequenceIndex += 1;
  }
}

export async function syncTaskNotificationSchedules(sql: SqlClient, userId: string, taskId: string, options?: {
  floatingIntervalMinutes?: number | null;
}) {
  await ensureNotificationSchedulingInfrastructure(sql);
  const task = await fetchTaskForScheduling(sql, userId, taskId);
  if (!task) return;

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

  await cancelPendingNotificationSchedulesForTask(sql, task.id, task.userId);

  if (!isSchedulableStatus(task.status) || task.deletedAt || task.status === 'cancelled') return;
  if (reminderMode === 'floating') {
    await scheduleFloatingTask(sql, { ...task, reminderMode, floatingIntervalMinutes }, new Date());
    return;
  }

  await scheduleTimedTask(sql, { ...task, reminderMode }, new Date());
}

export async function scheduleOverdueRemindersForTask(sql: SqlClient, task: TaskForScheduling) {
  if (!task.dueDate) return 0;
  const dueDate = new Date(task.dueDate);
  const overdueExpiresAt = task.overdueExpiresAt
    ? new Date(task.overdueExpiresAt)
    : addHours(dueDate, OVERDUE_LIFETIME_HOURS);
  const times = buildOverdueScheduleTimes(dueDate, overdueExpiresAt);
  let created = 0;

  for (const item of times) {
    const adjusted = applyScheduleSuppression(task, 'overdue_reminder', item.notifyAt);
    if (adjusted.action === 'cancel' || adjusted.notifyAt > overdueExpiresAt) continue;
    const minutesOverdue = Math.max(0, Math.floor((adjusted.notifyAt.getTime() - dueDate.getTime()) / 60000));
    await insertSchedule(sql, task, {
      kind: 'overdue_reminder',
      notifyAt: adjusted.notifyAt,
      title: 'Lembrete em atraso',
      message: `"${task.title}" está em atraso há ${formatOverdueDuration(minutesOverdue)}. Marque como concluído quando finalizar.`,
      tone: 'warning',
      sequenceIndex: item.sequenceIndex,
      intervalMinutes: item.intervalMinutes,
    });
    created += 1;
  }

  return created;
}

async function markTaskOverdueAndSchedule(sql: SqlClient, task: TaskForScheduling, dueDate: Date) {
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
  });
}

async function detectAndScheduleOverdueTasks(sql: SqlClient) {
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
      AND tasks.status IN ('pending', 'overdue')
      AND COALESCE(tasks.reminder_mode, 'timed') = 'timed'
      AND tasks.due_date IS NOT NULL
      AND tasks.due_date < NOW()
    LIMIT 200
  `;

  let detected = 0;
  for (const row of rows) {
    const task = mapTask(row);
    if (!task.dueDate) continue;
    await markTaskOverdueAndSchedule(sql, task, new Date(task.dueDate));
    detected += 1;
  }

  return detected;
}

async function claimDueSchedules(sql: SqlClient, limit: number) {
  const rows = await sql`
    WITH due AS (
      SELECT id
      FROM notification_schedules
      WHERE (
          status = 'pending'
          OR (status = 'processing' AND processing_started_at < NOW() - INTERVAL '10 minutes')
        )
        AND notify_at <= NOW()
      ORDER BY notify_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_schedules
    SET
      status = 'processing',
      processing_started_at = NOW(),
      updated_at = NOW()
    WHERE id IN (SELECT id FROM due)
    RETURNING
      id,
      user_id AS "userId",
      task_id AS "taskId",
      kind,
      notify_at AS "notifyAt",
      title,
      message,
      tone,
      dedupe_key AS "dedupeKey",
      sequence_index AS "sequenceIndex",
      interval_minutes AS "intervalMinutes"
  `;

  return rows.map(mapSchedule);
}

async function updateScheduleStatus(sql: SqlClient, scheduleId: string, status: NotificationScheduleStatus, errorMessage?: string) {
  await sql`
    UPDATE notification_schedules
    SET
      status = ${status},
      sent_at = CASE WHEN ${status} = 'sent' THEN NOW() ELSE sent_at END,
      failed_at = CASE WHEN ${status} = 'failed' THEN NOW() ELSE failed_at END,
      cancelled_at = CASE WHEN ${status} = 'cancelled' THEN NOW() ELSE cancelled_at END,
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

  await sendPushPayloadToUser(sql, schedule.userId, {
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

async function processSingleSchedule(sql: SqlClient, schedule: ScheduleRow) {
  const task = await fetchTaskForSchedule(sql, schedule);
  if (!task || task.deletedAt || !isSchedulableStatus(task.status)) {
    await updateScheduleStatus(sql, schedule.id, 'cancelled');
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
    await updateScheduleStatus(sql, schedule.id, 'cancelled');
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
    }
  }

  await updateScheduleStatus(sql, schedule.id, 'sent');
  return 'sent' as const;
}

export async function processNotificationSchedules(sql: SqlClient, limit = MAX_CRON_BATCH_SIZE): Promise<ProcessNotificationSchedulesSummary> {
  await ensureNotificationSchedulingInfrastructure(sql);
  const detectedOverdueTasks = await detectAndScheduleOverdueTasks(sql);
  const schedules = await claimDueSchedules(sql, limit);
  const summary: ProcessNotificationSchedulesSummary = {
    detectedOverdueTasks,
    processedSchedules: schedules.length,
    sentSchedules: 0,
    cancelledSchedules: 0,
    rescheduledSchedules: 0,
    failedSchedules: 0,
  };

  for (const schedule of schedules) {
    try {
      const result = await processSingleSchedule(sql, schedule);
      if (result === 'sent') summary.sentSchedules += 1;
      if (result === 'cancelled') summary.cancelledSchedules += 1;
      if (result === 'rescheduled') summary.rescheduledSchedules += 1;
    } catch (error) {
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

  return summary;
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
    id: String(row.taskId),
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
    cancelledSchedules += await cancelPendingNotificationSchedulesForTask(sql, String(row.id), String(row.userId));
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
    cancelledSchedules += await cancelPendingNotificationSchedulesForTask(sql, String(row.id), String(row.userId));
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
