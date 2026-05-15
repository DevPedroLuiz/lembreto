import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import webpush from 'web-push';
import type { SqlClient } from '../lib/handlers/core.js';
import {
  buildGoogleOAuthStateCookie,
  buildSessionCookie,
  clearGoogleOAuthStateCookie,
  clearSessionCookie,
  getGoogleOAuthStateFromCookieHeader,
  getSessionTokenFromCookieHeader,
} from '../lib/session.js';
import { isTrustedRequestOrigin } from '../lib/csrf.js';
import { MAX_AVATAR_BYTES, validateAvatarDataUrl } from '../lib/avatar.js';
import {
  createTaskSchema,
  formatZodError,
  loginSchema,
  profileUpdateSchema,
  registerSchema,
  updateTaskSchema,
} from '../lib/schemas.js';
import { getDerivedTaskStatus, getDerivedTaskStatusLabel } from '../src/lib/taskStatus.ts';

process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters';

function createSqlMock(options?: { blacklisted?: boolean; missingUser?: boolean }) {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ');

    if (query.includes('FROM token_blacklist')) {
      return options?.blacklisted ? [{ exists: 1 }] : [];
    }

    if (query.includes('FROM users')) {
      if (options?.missingUser) return [];
      return [{
        id: values[0],
        name: 'Pedro',
        email: 'pedro@example.com',
        avatar: null,
      }];
    }

    return [];
  };
}

function createNotificationScheduleSqlMock(options?: {
  future?: boolean;
  kind?: 'pre_notice' | 'notification' | 'alarm' | 'floating_reminder' | 'overdue_reminder';
  taskDueMinutesFromNow?: number;
  failPushLookup?: boolean;
  slowPushLookupMs?: number;
  scheduleUserId?: string;
  existingNotification?: boolean;
}) {
  const userId = '11111111-1111-4111-8111-111111111111';
  const scheduleUserId = options?.scheduleUserId ?? userId;
  const taskId = '22222222-2222-4222-8222-222222222222';
  const scheduleId = '33333333-3333-4333-8333-333333333333';
  const now = new Date('2026-05-14T17:40:36.651Z');
  const notifyAt = new Date(options?.future ? '2026-05-14T17:50:00.000Z' : '2026-05-14T17:39:00.000Z');
  const kind = options?.kind ?? 'notification';
  const taskDueDate = options?.taskDueMinutesFromNow === undefined
    ? notifyAt
    : new Date(now.getTime() + options.taskDueMinutesFromNow * 60_000);
  const schedule = {
    id: scheduleId,
    userId: scheduleUserId,
    taskId,
    kind,
    notifyAt: notifyAt.toISOString(),
    status: 'pending',
    title: kind === 'pre_notice' ? 'Lembrete em 15 minutos' : 'Esta na hora',
    message: kind === 'pre_notice' ? '"Teste" comeca em breve.' : '"Teste" chegou ao horario definido.',
    tone: 'info',
    dedupeKey: `user:${scheduleUserId}:task:${taskId}:${kind}:2026-05-14-17-39`,
    sequenceIndex: null,
    intervalMinutes: null,
    sentAt: null as string | null,
    failedAt: null as string | null,
    cancelledAt: null as string | null,
    processingStartedAt: null as string | null,
    errorMessage: null as string | null,
  };
  const notifications: Array<Record<string, unknown>> = options?.existingNotification
    ? [{
        id: '44444444-4444-4444-8444-444444444444',
        userId: schedule.userId,
        title: schedule.title,
        message: schedule.message,
        tone: schedule.tone,
        targetType: 'task',
        targetTaskId: schedule.taskId,
        dedupeKey: schedule.dedupeKey,
        sourceScheduleId: schedule.id,
        kind: schedule.kind,
        createdAt: now.toISOString(),
        read: false,
      }]
    : [];

  const matchesScheduleUserScope = (values: unknown[]) => {
    const scopedUserId = values.find((value) => value === userId || value === schedule.userId);
    return scopedUserId === undefined || scopedUserId === schedule.userId;
  };

  const rowForSchedule = () => ({
    id: schedule.id,
    userId: schedule.userId,
    taskId: schedule.taskId,
    kind: schedule.kind,
    notifyAt: schedule.notifyAt,
    title: schedule.title,
    message: schedule.message,
    tone: schedule.tone,
    dedupeKey: schedule.dedupeKey,
    sequenceIndex: schedule.sequenceIndex,
    intervalMinutes: schedule.intervalMinutes,
  });

  const mapNotification = (notification: Record<string, unknown>) => ({
    id: notification.id,
    title: notification.title,
    message: notification.message,
    createdAt: notification.createdAt,
    read: notification.read,
    tone: notification.tone,
    targetType: notification.targetType,
    targetTaskId: notification.targetTaskId,
    dedupeKey: notification.dedupeKey,
    sourceScheduleId: notification.sourceScheduleId,
    kind: notification.kind,
  });

  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ');

    if (query.includes('FROM token_blacklist')) {
      return [];
    }

    if (query.includes('FROM users') && !query.includes('FROM tasks') && !query.includes('INNER JOIN users')) {
      return values[0] === userId
        ? [{
            id: userId,
            name: 'Pedro',
            email: 'pedro@example.com',
            avatar: null,
          }]
        : [];
    }

    if (query.includes('SELECT NOW() AS "postgresNow"')) {
      return [{ postgresNow: now.toISOString() }];
    }

    if (query.includes('MIN(notify_at)')) {
      const isDue = schedule.status === 'pending' &&
        new Date(schedule.notifyAt) <= now &&
        schedule.sentAt === null &&
        schedule.failedAt === null &&
        schedule.cancelledAt === null &&
        matchesScheduleUserScope(values);
      return [{
        oldestPendingNotifyAt: schedule.status === 'pending' && matchesScheduleUserScope(values) ? schedule.notifyAt : null,
        duePendingCount: isDue ? 1 : 0,
        futurePendingCount: schedule.status === 'pending' && matchesScheduleUserScope(values) && !isDue ? 1 : 0,
      }];
    }

    if (query.includes('SELECT COUNT(*) AS count FROM notification_schedules WHERE status =')) {
      const status = String(values[0] ?? '');
      const statusFromQuery = query.match(/status = '([^']+)'/)?.[1] ?? status;
      return [{ count: schedule.status === statusFromQuery && matchesScheduleUserScope(values) ? 1 : 0 }];
    }

    if (query.includes('FROM notification_schedules') && query.includes('GROUP BY kind')) {
      const isDueQuery = query.includes('notify_at <= NOW()');
      const isDue = schedule.status === 'pending' &&
        new Date(schedule.notifyAt) <= now &&
        schedule.sentAt === null &&
        schedule.failedAt === null &&
        schedule.cancelledAt === null;
      if (schedule.status !== 'pending' || !matchesScheduleUserScope(values)) return [];
      if (isDueQuery && !isDue) return [];
      return [{ kind: schedule.kind, count: 1 }];
    }

    if (query.includes('FROM notification_schedules') && query.includes('LIMIT 5')) {
      const isDue = schedule.status === 'pending' &&
        new Date(schedule.notifyAt) <= now &&
        schedule.sentAt === null &&
        schedule.failedAt === null &&
        schedule.cancelledAt === null;
      return isDue && matchesScheduleUserScope(values)
        ? [{
            id: schedule.id,
            kind: schedule.kind,
            notifyAt: schedule.notifyAt,
            status: schedule.status,
            taskId: schedule.taskId,
          }]
        : [];
    }

    if (query.includes('WITH stuck AS') && query.includes('UPDATE notification_schedules')) {
      return [];
    }

    if (query.includes('WITH due AS') && query.includes('UPDATE notification_schedules ns')) {
      const isDue = schedule.status === 'pending' &&
        new Date(schedule.notifyAt) <= now &&
        schedule.sentAt === null &&
        schedule.failedAt === null &&
        schedule.cancelledAt === null &&
        matchesScheduleUserScope(values);
      if (!isDue) return [];
      schedule.status = 'processing';
      schedule.processingStartedAt = now.toISOString();
      return [rowForSchedule()];
    }

    if (query.includes('FROM tasks') && query.includes('INNER JOIN users')) {
      return [{
        id: taskId,
        userId: schedule.userId,
        title: 'Teste',
        description: '',
        dueDate: taskDueDate.toISOString(),
        status: 'pending',
        createdAt: '2026-05-14T17:00:00.000Z',
        alarmEnabled: false,
        reminderMode: 'timed',
        expiresAt: null,
        overdueSince: null,
        overdueExpiresAt: null,
        deletedAt: null,
        mutedUntil: null,
        suppressHolidayNotifications: false,
        floatingIntervalMinutes: null,
        notificationsEnabled: true,
        stateCode: null,
        cityName: null,
        holidayRegionCode: null,
      }];
    }

    if (query.includes('FROM notifications') && query.includes('WHERE user_id')) {
      if (query.includes('ORDER BY created_at DESC')) {
        return notifications
          .filter((notification) => notification.userId === values[0])
          .map(mapNotification);
      }

      const dedupeKey = values.find((value) => value === schedule.dedupeKey);
      const sourceScheduleId = values.find((value) => value === schedule.id);
      const existing = notifications.find((notification) => (
        notification.dedupeKey === dedupeKey ||
        notification.sourceScheduleId === sourceScheduleId
      ));
      return existing ? [mapNotification(existing)] : [];
    }

    if (query.includes('INSERT INTO notifications')) {
      const notification = {
        id: '44444444-4444-4444-8444-444444444444',
        userId: values[0],
        title: values[1],
        message: values[2],
        tone: values[3],
        targetType: values[4],
        targetTaskId: values[5],
        dedupeKey: values[6],
        sourceScheduleId: values[7],
        kind: values[8],
        createdAt: now.toISOString(),
        read: false,
      };
      notifications.push(notification);
      return [mapNotification(notification)];
    }

    if (query.includes('SELECT notifications_enabled AS "notificationsEnabled"')) {
      if (options?.slowPushLookupMs) {
        await new Promise((resolve) => setTimeout(resolve, options.slowPushLookupMs));
      }
      if (options?.failPushLookup) throw new Error('push lookup failed');
      return [{ notificationsEnabled: true }];
    }

    if (query.includes('FROM push_subscriptions')) {
      return [];
    }

    if (query.includes('UPDATE notification_schedules') && query.includes('sent_at = CASE')) {
      const status = String(values[0]);
      schedule.status = status;
      schedule.sentAt = status === 'sent' ? now.toISOString() : schedule.sentAt;
      schedule.failedAt = status === 'failed' ? now.toISOString() : schedule.failedAt;
      schedule.cancelledAt = status === 'cancelled' ? now.toISOString() : schedule.cancelledAt;
      schedule.processingStartedAt = null;
      schedule.errorMessage = typeof values[4] === 'string' ? values[4] : null;
      return [];
    }

    if (query.includes('information_schema.columns') || query.includes('to_regclass')) {
      return [{
        hasUserSetting: true,
        hasNotifications: true,
        hasPushSubscriptions: true,
        hasNotificationKind: true,
        hasCreatedIndex: true,
        hasReadIndex: true,
        hasDedupeIndex: true,
        hasSourceScheduleIndex: true,
        hasPushIndex: true,
      }];
    }

    return [];
  }) as SqlClient;

  return {
    sql,
    schedule,
    notifications,
  };
}

function createTaskSideEffectsSqlMock(options?: {
  alarmEnabled?: boolean;
  dueMinutesFromNow?: number;
  includeExternalCalendarJob?: boolean;
  includeNotificationJob?: boolean;
  externalFirst?: boolean;
  hangExternalCalendarIntegrations?: boolean;
}) {
  const now = new Date();
  const userId = '55555555-5555-4555-8555-555555555555';
  const taskId = '66666666-6666-4666-8666-666666666666';
  const dueDate = new Date(now.getTime() + (options?.dueMinutesFromNow ?? 5) * 60_000);
  const jobs = [
    ...(options?.includeExternalCalendarJob
      ? [{
          id: '77777777-7777-4777-8777-777777777777',
          userId,
          taskId,
          kind: 'sync_external_calendar',
          status: 'pending',
          attempts: 0,
          dedupeKey: `user:${userId}:task:${taskId}:sync-calendar`,
          availableAt: new Date(now.getTime() - (options.externalFirst ? 60_000 : 0)).toISOString(),
          createdAt: new Date(now.getTime() - (options.externalFirst ? 60_000 : 0)).toISOString(),
          processingStartedAt: null as string | null,
          doneAt: null as string | null,
          failedAt: null as string | null,
          cancelledAt: null as string | null,
          errorMessage: null as string | null,
        }]
      : []),
    ...(options?.includeNotificationJob === false
      ? []
      : [{
          id: '88888888-8888-4888-8888-888888888888',
          userId,
          taskId,
          kind: 'sync_notification_schedules',
          status: 'pending',
          attempts: 0,
          dedupeKey: `user:${userId}:task:${taskId}:sync-schedules`,
          availableAt: now.toISOString(),
          createdAt: now.toISOString(),
          processingStartedAt: null as string | null,
          doneAt: null as string | null,
          failedAt: null as string | null,
          cancelledAt: null as string | null,
          errorMessage: null as string | null,
        }]),
  ];
  const task = {
    id: taskId,
    userId,
    title: 'Teste side effect',
    description: '',
    dueDate: dueDate.toISOString(),
    status: 'pending',
    createdAt: new Date(now.getTime() - 60_000).toISOString(),
    alarmEnabled: Boolean(options?.alarmEnabled),
    reminderMode: 'timed',
    expiresAt: null,
    overdueSince: null,
    overdueExpiresAt: null,
    deletedAt: null,
    completedAt: null,
    mutedUntil: null,
    suppressHolidayNotifications: false,
    floatingIntervalMinutes: null,
    notificationsEnabled: true,
    stateCode: null,
    cityName: null,
    holidayRegionCode: null,
    externalCalendarProvider: null as string | null,
    externalCalendarEventId: null as string | null,
    externalCalendarSyncStatus: 'pending',
    externalCalendarLastError: null as string | null,
    externalCalendarSyncedAt: null as string | null,
  };
  const schedules: Array<Record<string, unknown>> = [];

  const jobRow = (job: typeof jobs[number]) => ({
    id: job.id,
    userId: job.userId,
    taskId: job.taskId,
    kind: job.kind,
    attempts: job.attempts,
    dedupeKey: job.dedupeKey,
  });

  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ');

    if (query.includes('SELECT NOW() AS "postgresNow"')) {
      return [{ postgresNow: now.toISOString() }];
    }

    if (query.includes('FROM task_side_effects') && query.includes('MIN(available_at)')) {
      const dueJobs = jobs.filter((job) => (
        job.status === 'pending' &&
        new Date(job.availableAt) <= now &&
        job.cancelledAt === null
      ));
      return [{
        oldestPendingAvailableAt: jobs
          .filter((job) => job.status === 'pending')
          .map((job) => job.availableAt)
          .sort()[0] ?? null,
        duePendingCount: dueJobs.length,
        oldestPendingAgeSeconds: dueJobs.length > 0 ? 0 : null,
      }];
    }

    if (query.includes('SELECT COUNT(*) AS count FROM task_side_effects WHERE status =')) {
      const statusFromQuery = query.match(/status = '([^']+)'/)?.[1] ?? '';
      return [{ count: jobs.filter((job) => job.status === statusFromQuery).length }];
    }

    if (query.includes('FROM task_side_effects') && query.includes('GROUP BY kind')) {
      const dueOnly = query.includes('available_at <= NOW()');
      const counts = new Map<string, number>();
      for (const job of jobs) {
        if (job.status !== 'pending') continue;
        if (dueOnly && (new Date(job.availableAt) > now || job.cancelledAt !== null)) continue;
        counts.set(job.kind, (counts.get(job.kind) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([kind, count]) => ({ kind, count }));
    }

    if (query.includes('WITH stuck AS') && query.includes('UPDATE task_side_effects')) {
      return [];
    }

    if (query.includes('WITH due AS') && query.includes('UPDATE task_side_effects tse')) {
      const booleanValues = values.filter((value): value is boolean => typeof value === 'boolean');
      const notificationSchedulesOnly = Boolean(booleanValues[0]);
      const externalCalendarOnly = Boolean(booleanValues[1]);
      const limitValue = values.find((value) => typeof value === 'number');
      const limit = Number(limitValue ?? 10);
      const priority = (kind: string) => {
        if (kind === 'sync_notification_schedules') return 1;
        if (kind === 'cancel_notification_schedules') return 2;
        if (kind === 'sync_external_calendar') return 3;
        if (kind === 'delete_external_calendar_event') return 4;
        return 5;
      };
      const claimed = jobs
        .filter((job) => (
          job.status === 'pending' &&
          new Date(job.availableAt) <= now &&
          job.cancelledAt === null &&
          (!notificationSchedulesOnly || job.kind === 'sync_notification_schedules' || job.kind === 'cancel_notification_schedules') &&
          (!externalCalendarOnly || job.kind === 'sync_external_calendar' || job.kind === 'delete_external_calendar_event')
        ))
        .sort((a, b) => (
          priority(a.kind) - priority(b.kind) ||
          a.availableAt.localeCompare(b.availableAt) ||
          a.createdAt.localeCompare(b.createdAt)
        ))
        .slice(0, limit);

      for (const job of claimed) {
        job.status = 'processing';
        job.processingStartedAt = now.toISOString();
      }
      return claimed.map(jobRow);
    }

    if (query.includes('SELECT 1') && query.includes('FROM tasks')) {
      return [{ exists: 1 }];
    }

    if (query.includes('FROM tasks') && query.includes('external_calendar_sync_status')) {
      return [{
        id: task.id,
        userId: task.userId,
        title: task.title,
        description: task.description,
        dueDate: task.dueDate,
        endDate: null,
        priority: 'medium',
        category: 'Geral',
        tags: [],
        status: task.status,
        externalCalendarProvider: task.externalCalendarProvider,
        externalCalendarEventId: task.externalCalendarEventId,
        externalCalendarSyncStatus: task.externalCalendarSyncStatus,
        externalCalendarLastError: task.externalCalendarLastError,
        externalCalendarSyncedAt: task.externalCalendarSyncedAt,
      }];
    }

    if (query.includes('FROM calendar_integrations')) {
      if (options?.hangExternalCalendarIntegrations) {
        return new Promise<Array<Record<string, unknown>>>(() => undefined);
      }
      return [];
    }

    if (query.includes('FROM tasks') && query.includes('INNER JOIN users')) {
      return [{
        id: task.id,
        userId: task.userId,
        title: task.title,
        description: task.description,
        dueDate: task.dueDate,
        status: task.status,
        createdAt: task.createdAt,
        alarmEnabled: task.alarmEnabled,
        reminderMode: task.reminderMode,
        expiresAt: task.expiresAt,
        overdueSince: task.overdueSince,
        overdueExpiresAt: task.overdueExpiresAt,
        deletedAt: task.deletedAt,
        mutedUntil: task.mutedUntil,
        suppressHolidayNotifications: task.suppressHolidayNotifications,
        floatingIntervalMinutes: task.floatingIntervalMinutes,
        notificationsEnabled: task.notificationsEnabled,
        stateCode: task.stateCode,
        cityName: task.cityName,
        holidayRegionCode: task.holidayRegionCode,
      }];
    }

    if (query.includes('FROM tasks') && query.includes('NOT EXISTS') && query.includes('notification_schedules')) {
      const activeSchedules = schedules.filter((schedule) => (
        schedule.userId === task.userId &&
        schedule.taskId === task.id &&
        (schedule.status === 'pending' || schedule.status === 'processing')
      ));
      if (task.status !== 'pending' || task.deletedAt || activeSchedules.length > 0) return [];
      return [{ id: task.id, userId: task.userId }];
    }

    if (query.includes('UPDATE tasks') && query.includes('reminder_mode')) {
      task.reminderMode = String(values[0]);
      return [];
    }

    if (query.includes('UPDATE tasks') && query.includes('external_calendar_sync_status')) {
      const statusIndex = values.findIndex((value) => value === 'failed' || value === 'synced' || value === 'idle' || value === 'pending');
      const literalStatus = query.match(/external_calendar_sync_status = '([^']+)'/)?.[1];
      task.externalCalendarSyncStatus = String(values[statusIndex] ?? literalStatus ?? task.externalCalendarSyncStatus);
      task.externalCalendarLastError = values.find((value) => typeof value === 'string' && String(value).includes('sync_external_calendar')) as string | null ?? task.externalCalendarLastError;
      task.externalCalendarSyncedAt = task.externalCalendarSyncStatus === 'synced' ? now.toISOString() : null;
      return [];
    }

    if (query.includes('UPDATE notification_schedules') && query.includes("status = 'cancelled'")) {
      return [];
    }

    if (query.includes('INSERT INTO notification_schedules')) {
      const schedule = {
        id: crypto.randomUUID(),
        userId: values[0],
        taskId: values[1],
        kind: values[2],
        notifyAt: values[3] instanceof Date ? values[3].toISOString() : String(values[3]),
        title: values[4],
        message: values[5],
        tone: values[6],
        dedupeKey: values[7],
        status: 'pending',
      };
      if (!schedules.some((item) => item.dedupeKey === schedule.dedupeKey && item.userId === schedule.userId)) {
        schedules.push(schedule);
        return [{ id: schedule.id }];
      }
      return [];
    }

    if (query.includes('SELECT COUNT(*) AS count') && query.includes('FROM notification_schedules')) {
      return [{ count: schedules.filter((schedule) => (
        schedule.userId === values[0] &&
        schedule.taskId === values[1] &&
        (schedule.status === 'pending' || schedule.status === 'processing')
      )).length }];
    }

    if (query.includes('UPDATE task_side_effects') && query.includes('done_at = CASE')) {
      const status = String(values[0]);
      const errorMessage = typeof values[7] === 'string' ? values[7] : null;
      const jobId = String(values[8]);
      const job = jobs.find((item) => item.id === jobId);
      if (job && job.status === 'processing') {
        job.status = status;
        if (status === 'pending' || status === 'failed') {
          job.attempts += 1;
        }
        job.processingStartedAt = status === 'processing' ? job.processingStartedAt : null;
        job.doneAt = status === 'done' ? now.toISOString() : job.doneAt;
        job.failedAt = status === 'failed' ? now.toISOString() : job.failedAt;
        job.cancelledAt = status === 'cancelled' ? now.toISOString() : job.cancelledAt;
        job.errorMessage = errorMessage;
      }
      return [];
    }

    return [];
  }) as SqlClient;

  return {
    sql,
    jobs,
    task,
    schedules,
  };
}

function createCronHealthSqlMock(options?: {
  neverNow?: boolean;
  taskSideEffectsPending?: number;
  taskSideEffectsDue?: number;
  schedulesPending?: number;
  schedulesDue?: number;
  tasksPending?: number;
  overdueCandidates?: number;
}) {
  const now = new Date('2026-05-14T21:30:00.000Z');
  const sql = (async (strings: TemplateStringsArray) => {
    const query = strings.join(' ');

    if (query.includes('SELECT NOW() AS now')) {
      if (options?.neverNow) {
        return new Promise<Array<Record<string, unknown>>>(() => undefined);
      }
      return [{ now: now.toISOString() }];
    }

    if (query.includes('NOW() AS "postgresNow"') && query.includes('FROM notification_schedules')) {
      return [{
        postgresNow: now.toISOString(),
        oldestPendingNotifyAt: options?.schedulesPending ? now.toISOString() : null,
        duePendingCount: options?.schedulesDue ?? 0,
        futurePendingCount: Math.max(0, (options?.schedulesPending ?? 0) - (options?.schedulesDue ?? 0)),
        processingCount: 0,
        failedCount: 0,
        cancelledCount: 0,
      }];
    }

    if (query.includes('NOW() AS "postgresNow"') && query.includes('FROM task_side_effects')) {
      return [{
        postgresNow: now.toISOString(),
        oldestPendingAvailableAt: options?.taskSideEffectsPending ? now.toISOString() : null,
        duePendingCount: options?.taskSideEffectsDue ?? 0,
        processingCount: 0,
        failedCount: 0,
        doneCount: 0,
        oldestPendingAgeSeconds: 0,
      }];
    }

    if (query.includes('FROM notification_schedules') && query.includes('GROUP BY kind')) {
      const dueOnly = query.includes('notify_at <= NOW()');
      const count = dueOnly ? options?.schedulesDue ?? 0 : options?.schedulesPending ?? 0;
      return count > 0 ? [{ kind: 'notification', count }] : [];
    }

    if (query.includes('FROM task_side_effects') && query.includes('GROUP BY kind')) {
      const dueOnly = query.includes('available_at <= NOW()');
      const count = dueOnly ? options?.taskSideEffectsDue ?? 0 : options?.taskSideEffectsPending ?? 0;
      return count > 0 ? [{ kind: 'sync_notification_schedules', count }] : [];
    }

    if (query.includes('FROM task_side_effects') && query.includes('available_at <= NOW()')) {
      return [{ count: options?.taskSideEffectsDue ?? 0 }];
    }

    if (query.includes('FROM task_side_effects')) {
      return [{ count: options?.taskSideEffectsPending ?? 0 }];
    }

    if (query.includes('FROM notification_schedules') && query.includes('notify_at <= NOW()')) {
      return [{ count: options?.schedulesDue ?? 0 }];
    }

    if (query.includes('FROM notification_schedules')) {
      return [{ count: options?.schedulesPending ?? 0 }];
    }

    if (query.includes('FROM tasks') && query.includes('due_date < NOW()')) {
      return [{ count: options?.overdueCandidates ?? 0 }];
    }

    if (query.includes('FROM tasks')) {
      return [{ count: options?.tasksPending ?? 0 }];
    }

    if (query.includes('FROM pg_stat_activity')) {
      return [{ longRunningActive: 0, waitingOnLock: 0 }];
    }

    if (query.includes('FROM pg_locks')) {
      return [{ waitingLocksOnReminderTables: 0, grantedLocksOnReminderTables: 0 }];
    }

    return [];
  }) as SqlClient;

  return sql;
}

async function run(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  const { signToken } = await import('../lib/jwt.js');
  const {
    buildTokenJti,
    getAuthFailureResponse,
    requireAuthFromToken,
  } = await import('../lib/auth.js');
  const { getRecaptchaSiteKey } = await import('../lib/recaptcha.js');
  const {
    buildTasksIcs,
  } = await import('../lib/calendar/ics.js');
  const {
    encryptCalendarToken,
    decryptCalendarToken,
  } = await import('../lib/calendar/crypto.js');
  const {
    buildGoogleCalendarAuthorizationUrl,
    googleCalendarClient,
  } = await import('../lib/calendar/googleCalendar.js');
  const {
    buildOutlookCalendarAuthorizationUrl,
  } = await import('../lib/calendar/outlookCalendar.js');
  const {
    toPublicIntegrations,
  } = await import('../lib/calendar/calendarSync.js');
  const {
    handleCalendarIntegrations,
    handleCalendarSyncAll,
  } = await import('../lib/handlers/calendar.js');
  const { handleNotificationProcessDue } = await import('../lib/handlers/notifications.js');
  const {
    backfillMissingNotificationSchedules,
    processDueNotificationSchedules,
    scheduleOverdueRemindersForTask,
  } = await import('../lib/notification-schedules.js');
  const {
    processExternalCalendarSideEffects,
    processTaskSideEffects,
  } = await import('../lib/task-side-effects.js');
  const { requiresWorkEndDateForStatus } = await import('../lib/contracts.js');

  await run('buildTokenJti composes subject and iat', () => {
    assert.equal(buildTokenJti({ sub: 'user-1', iat: 42 }), 'user-1_42');
    assert.equal(buildTokenJti({ sub: 'user-1' }), 'user-1_0');
  });

  await run('requireAuthFromToken returns payload and user for valid token', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const auth = await requireAuthFromToken(createSqlMock(), token);
    assert.equal(auth.user.id, 'user-1');
    assert.equal(auth.user.email, 'pedro@example.com');
    assert.equal(auth.payload.sub, 'user-1');
  });

  await run('requireAuthFromToken rejects blacklisted token', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });

    await assert.rejects(
      requireAuthFromToken(createSqlMock({ blacklisted: true }), token),
      (error: unknown) => {
        const response = getAuthFailureResponse(error);
        assert.deepEqual(response, {
          status: 401,
          error: 'Sessão encerrada. Faça login novamente.',
        });
        return true;
      },
    );
  });

  await run('session cookie helpers set and clear auth cookie', () => {
    const cookie = buildSessionCookie('token-123', 60);
    assert.match(cookie, /lembreto_session=token-123/);
    assert.match(cookie, /HttpOnly/);

    const cleared = clearSessionCookie();
    assert.match(cleared, /Max-Age=0/);

    const token = getSessionTokenFromCookieHeader('foo=bar; lembreto_session=token-123; theme=dark');
    assert.equal(token, 'token-123');
  });

  await run('google oauth state cookie helpers set and clear state cookie', () => {
    const cookie = buildGoogleOAuthStateCookie('state-123', 600);
    assert.match(cookie, /lembreto_google_oauth_state=state-123/);
    assert.match(cookie, /SameSite=Lax/);

    const cleared = clearGoogleOAuthStateCookie();
    assert.match(cleared, /Max-Age=0/);

    const state = getGoogleOAuthStateFromCookieHeader('foo=bar; lembreto_google_oauth_state=state-123');
    assert.equal(state, 'state-123');
  });

  await run('csrf helper rejects cross-site requests', () => {
    assert.equal(
      isTrustedRequestOrigin({
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'sec-fetch-site': 'same-origin',
      }),
      true,
    );

    assert.equal(
      isTrustedRequestOrigin({
        host: 'localhost:3000',
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      false,
    );
  });

  await run('recaptcha site key prefers Vite env and falls back to runtime env', () => {
    const previousViteKey = process.env.VITE_RECAPTCHA_SITE_KEY;
    const previousRuntimeKey = process.env.RECAPTCHA_SITE_KEY;

    try {
      delete process.env.VITE_RECAPTCHA_SITE_KEY;
      process.env.RECAPTCHA_SITE_KEY = ' runtime-site-key ';
      assert.equal(getRecaptchaSiteKey(), 'runtime-site-key');

      process.env.VITE_RECAPTCHA_SITE_KEY = ' vite-site-key ';
      assert.equal(getRecaptchaSiteKey(), 'vite-site-key');
    } finally {
      if (previousViteKey === undefined) {
        delete process.env.VITE_RECAPTCHA_SITE_KEY;
      } else {
        process.env.VITE_RECAPTCHA_SITE_KEY = previousViteKey;
      }

      if (previousRuntimeKey === undefined) {
        delete process.env.RECAPTCHA_SITE_KEY;
      } else {
        process.env.RECAPTCHA_SITE_KEY = previousRuntimeKey;
      }
    }
  });

  await run('avatar validator enforces mime type and size limit', () => {
    const validPayload = Buffer.from('avatar-image').toString('base64');
    const validAvatar = `data:image/png;base64,${validPayload}`;
    assert.equal(validateAvatarDataUrl(validAvatar).valid, true);

    const invalidMime = `data:text/plain;base64,${validPayload}`;
    assert.equal(validateAvatarDataUrl(invalidMime).valid, false);

    const bigPayload = Buffer.alloc(MAX_AVATAR_BYTES + 1).toString('base64');
    const hugeAvatar = `data:image/png;base64,${bigPayload}`;
    assert.equal(validateAvatarDataUrl(hugeAvatar).valid, false);
  });

  await run('register schema trims and validates payloads', () => {
    const parsed = registerSchema.parse({
      name: ' Pedro ',
      email: 'pedro@example.com',
      password: '123456',
    });

    assert.equal(parsed.name, 'Pedro');
    assert.throws(() => registerSchema.parse({
      name: '',
      email: 'invalid',
      password: '123',
    }));
  });

  await run('login schema rejects malformed email', () => {
    assert.throws(() => loginSchema.parse({
      email: 'not-an-email',
      password: '123456',
    }));
  });

  await run('profile schema accepts null avatar and rejects invalid avatar', () => {
    assert.deepEqual(profileUpdateSchema.parse({ avatar: null }), { avatar: null });

    assert.throws(() => profileUpdateSchema.parse({
      avatar: 'data:text/plain;base64,Zm9v',
    }));
  });

  await run('task schemas validate create and update payloads', () => {
    const created = createTaskSchema.parse({
      title: 'Estudar',
      description: 'Revisar schemas',
      dueDate: new Date().toISOString(),
      priority: 'high',
      category: 'Estudos',
      suppressHolidayNotifications: true,
    });

    assert.equal(created.priority, 'high');
    assert.equal(created.suppressHolidayNotifications, true);

    const updated = updateTaskSchema.parse({
      status: 'completed',
      suppressHolidayNotifications: false,
    });

    assert.equal(updated.status, 'completed');
    assert.equal(updated.suppressHolidayNotifications, false);

    const result = updateTaskSchema.safeParse({});
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatZodError(result.error), 'Envie ao menos um campo para atualizar');
    }
  });

  await run('work end time requirement applies only to active statuses', () => {
    assert.equal(requiresWorkEndDateForStatus('pending'), true);
    assert.equal(requiresWorkEndDateForStatus('overdue'), true);
    assert.equal(requiresWorkEndDateForStatus('completed'), false);
    assert.equal(requiresWorkEndDateForStatus('cancelled'), false);
    assert.equal(requiresWorkEndDateForStatus('inactive'), false);
    assert.equal(requiresWorkEndDateForStatus('draft'), false);
  });

  await run('UI derived task status treats pending past due as overdue', () => {
    const now = new Date('2026-05-15T12:00:00.000Z');

    assert.equal(getDerivedTaskStatus({
      status: 'pending',
      dueDate: '2026-05-15T11:59:59.000Z',
      deletedAt: null,
    }, now), 'overdue');
    assert.equal(getDerivedTaskStatus({
      status: 'pending',
      dueDate: '2026-05-15T12:05:00.000Z',
      deletedAt: null,
    }, now), 'pending');
    assert.equal(getDerivedTaskStatus({
      status: 'completed',
      dueDate: '2026-05-15T11:59:59.000Z',
      deletedAt: null,
    }, now), 'completed');
    assert.equal(getDerivedTaskStatus({
      status: 'inactive',
      dueDate: '2026-05-15T12:05:00.000Z',
      deletedAt: null,
    }, now), 'cancelled');
    assert.equal(getDerivedTaskStatusLabel('overdue'), 'Atrasado');
  });

  await run('calendar export builds Google/Outlook compatible ICS', () => {
    const ics = buildTasksIcs([
      {
        id: 'task-1',
        title: 'Reunião, revisão',
        description: 'Levar pauta\nConfirmar sala',
        dueDate: '2026-05-06T12:00:00.000Z',
        priority: 'high',
        category: 'Trabalho',
        tags: ['Cliente'],
        status: 'pending',
        createdAt: '2026-05-01T10:00:00.000Z',
      },
    ], new Date('2026-05-01T12:00:00.000Z'));

    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /VERSION:2.0/);
    assert.match(ics, /BEGIN:VEVENT/);
    assert.match(ics, /SUMMARY:Reunião\\, revisão/);
    assert.match(ics, /DESCRIPTION:Levar pauta\\nConfirmar sala/);
    assert.match(ics, /DTSTART;TZID=America\/Sao_Paulo:20260506T090000/);
    assert.match(ics, /BEGIN:VALARM/);
  });

  await run('calendar export keeps date-only reminders as all-day events', () => {
    const ics = buildTasksIcs([
      {
        id: 'task-2',
        title: 'Dia todo',
        dueDate: '2026-05-07T02:59:00.000Z',
        priority: 'medium',
      },
    ], new Date('2026-05-01T12:00:00.000Z'));

    assert.match(ics, /DTSTART;VALUE=DATE:20260506/);
    assert.match(ics, /DTEND;VALUE=DATE:20260507/);
  });

  await run('calendar token encryption round-trips without storing plaintext', () => {
    const encrypted = encryptCalendarToken('secret-calendar-token');
    assert.notEqual(encrypted, 'secret-calendar-token');
    assert.equal(decryptCalendarToken(encrypted), 'secret-calendar-token');
  });

  await run('calendar OAuth URLs request narrow calendar scopes', () => {
    const previousGoogleClientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const previousGoogleClientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    const previousOutlookClientId = process.env.OUTLOOK_CLIENT_ID;
    const previousOutlookClientSecret = process.env.OUTLOOK_CLIENT_SECRET;

    try {
      process.env.GOOGLE_CALENDAR_CLIENT_ID = 'google-client';
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'google-secret';
      process.env.OUTLOOK_CLIENT_ID = 'outlook-client';
      process.env.OUTLOOK_CLIENT_SECRET = 'outlook-secret';

      const googleUrl = new URL(buildGoogleCalendarAuthorizationUrl({
        state: 'state-123',
        redirectUri: 'http://localhost/google',
      }));
      assert.equal(googleUrl.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
      assert.equal(googleUrl.searchParams.get('access_type'), 'offline');

      const outlookUrl = new URL(buildOutlookCalendarAuthorizationUrl({
        state: 'state-123',
        redirectUri: 'http://localhost/outlook',
      }));
      assert.equal(outlookUrl.searchParams.get('scope'), 'offline_access Calendars.ReadWrite');
    } finally {
      if (previousGoogleClientId === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
      else process.env.GOOGLE_CALENDAR_CLIENT_ID = previousGoogleClientId;
      if (previousGoogleClientSecret === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
      else process.env.GOOGLE_CALENDAR_CLIENT_SECRET = previousGoogleClientSecret;
      if (previousOutlookClientId === undefined) delete process.env.OUTLOOK_CLIENT_ID;
      else process.env.OUTLOOK_CLIENT_ID = previousOutlookClientId;
      if (previousOutlookClientSecret === undefined) delete process.env.OUTLOOK_CLIENT_SECRET;
      else process.env.OUTLOOK_CLIENT_SECRET = previousOutlookClientSecret;
    }
  });

  await run('calendar integrations public payload hides encrypted tokens', () => {
    const publicItems = toPublicIntegrations([
      {
        id: 'integration-1',
        userId: 'user-1',
        provider: 'google',
        accessTokenEncrypted: 'encrypted-access',
        refreshTokenEncrypted: 'encrypted-refresh',
        expiresAt: null,
        calendarId: 'primary',
        syncEnabled: true,
        lastError: null,
        createdAt: '2026-05-01T10:00:00.000Z',
        updatedAt: '2026-05-01T10:00:00.000Z',
      },
    ]);

    assert.equal(publicItems.length, 2);
    assert.deepEqual(publicItems[0], {
      provider: 'google',
      connected: true,
      syncEnabled: true,
      calendarId: 'primary',
      lastError: null,
      updatedAt: '2026-05-01T10:00:00.000Z',
    });
    assert.equal('accessTokenEncrypted' in publicItems[0], false);
  });

  await run('calendar integrations route requires auth and returns public providers', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const result = await handleCalendarIntegrations({
      sql: createSqlMock(),
      request: {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      },
    });

    assert.equal(result.status, 200);
    const body = result.body as { integrations: Array<{ provider: string; connected: boolean }> };
    assert.equal(body.integrations.length, 2);
    assert.equal(body.integrations[0].connected, false);
  });

  await run('google calendar event import requests only events from sync day onward', async () => {
    const originalFetch = globalThis.fetch;
    const requestedTimeMin = '2026-05-07T03:00:00.000Z';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('timeMin'), requestedTimeMin);
      return new Response(JSON.stringify({
        items: [{
          id: 'google-event-1',
          summary: 'Evento futuro',
          description: 'Importado do Google',
          start: { dateTime: '2026-05-07T12:00:00-03:00' },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const events = await googleCalendarClient.listEvents('access-token', 'primary', requestedTimeMin);
      assert.equal(events.length, 1);
      assert.equal(events[0].id, 'google-event-1');
      assert.equal(events[0].title, 'Evento futuro');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await run('calendar sync all route returns a clear summary when provider is not connected', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const result = await handleCalendarSyncAll({
      sql: createSqlMock(),
      request: {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        params: { provider: 'google' },
      },
    });

    assert.equal(result.status, 200);
    const body = result.body as {
      result: {
        provider: string;
        pushed: number;
        imported: number;
        skipped: number;
        deduplicated: number;
        failed: number;
        errors: string[];
      };
      integrations: Array<{ provider: string; connected: boolean }>;
    };
    assert.deepEqual(body.result, {
      provider: 'google',
      pushed: 0,
      imported: 0,
      skipped: 0,
      deduplicated: 0,
      failed: 1,
      errors: ['Conecte o Google Calendar antes de sincronizar.'],
    });
    assert.equal(body.integrations.length, 2);
  });

  await run('processes due notification schedule and marks it sent', async () => {
    const { sql, schedule, notifications } = createNotificationScheduleSqlMock();
    const result = await processDueNotificationSchedules(sql, 20);

    assert.equal(result.fetchedSchedules, 1);
    assert.equal(result.processedSchedules, 1);
    assert.equal(result.sentSchedules, 1);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].sourceScheduleId, schedule.id);
    assert.equal(schedule.status, 'sent');
    assert.notEqual(schedule.sentAt, null);
    assert.equal(result.schedulesByKindProcessed.notification, 1);
  });

  await run('processes due pre notice schedule and marks it sent', async () => {
    const { sql, schedule, notifications } = createNotificationScheduleSqlMock({ kind: 'pre_notice' });
    const result = await processDueNotificationSchedules(sql, 20);

    assert.equal(result.fetchedSchedules, 1);
    assert.equal(result.processedSchedules, 1);
    assert.equal(result.sentSchedules, 1);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].sourceScheduleId, schedule.id);
    assert.equal(notifications[0].kind, 'pre_notice');
    assert.equal(schedule.status, 'sent');
    assert.notEqual(schedule.sentAt, null);
    assert.equal(result.schedulesByKindProcessed.pre_notice, 1);
  });

  await run('processes due pre notice while task due date is still future', async () => {
    const { sql, schedule, notifications } = createNotificationScheduleSqlMock({
      kind: 'pre_notice',
      taskDueMinutesFromNow: 5,
    });
    const result = await processDueNotificationSchedules(sql, 20);

    assert.equal(result.fetchedSchedules, 1);
    assert.equal(result.sentSchedules, 1);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].sourceScheduleId, schedule.id);
    assert.equal(schedule.status, 'sent');
  });

  await run('due diagnostics include due pre notice by kind', async () => {
    const { sql } = createNotificationScheduleSqlMock({ kind: 'pre_notice' });
    const result = await processDueNotificationSchedules(sql, 20);

    assert.equal(result.scheduleDiagnostics.duePendingCount, 1);
    assert.equal(result.scheduleDiagnostics.dueByKind.pre_notice, 1);
    assert.equal(result.fetchedSchedules, 1);
  });

  await run('does not process future notification schedule', async () => {
    const { sql, schedule, notifications } = createNotificationScheduleSqlMock({ future: true });
    const result = await processDueNotificationSchedules(sql, 20);

    assert.equal(result.scheduleDiagnostics.futurePendingCount, 1);
    assert.equal(result.fetchedSchedules, 0);
    assert.equal(result.processedSchedules, 0);
    assert.equal(notifications.length, 0);
    assert.equal(schedule.status, 'pending');
    assert.equal(schedule.sentAt, null);
  });

  await run('authenticated fallback reflects due notification for logged user', async () => {
    const { sql, schedule, notifications } = createNotificationScheduleSqlMock();
    const token = signToken({ sub: schedule.userId, email: 'pedro@example.com' });
    const response = await handleNotificationProcessDue({
      sql,
      request: {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      },
    });

    assert.equal(response.status, 200);
    const body = response.body as { ok: boolean; notifications: Array<Record<string, unknown>> };
    assert.equal(body.ok, true);
    assert.equal(notifications.length, 1);
    assert.equal(body.notifications.length, 1);
    assert.equal(body.notifications[0].sourceScheduleId, schedule.id);
    assert.equal(schedule.status, 'sent');
    assert.notEqual(schedule.sentAt, null);
  });

  await run('authenticated fallback does not duplicate existing notification', async () => {
    const { sql, schedule, notifications } = createNotificationScheduleSqlMock({ existingNotification: true });
    const token = signToken({ sub: schedule.userId, email: 'pedro@example.com' });
    const response = await handleNotificationProcessDue({
      sql,
      request: {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      },
    });

    assert.equal(response.status, 200);
    const body = response.body as { ok: boolean; notifications: Array<Record<string, unknown>> };
    assert.equal(body.ok, true);
    assert.equal(notifications.length, 1);
    assert.equal(body.notifications.length, 1);
    assert.equal(body.notifications[0].sourceScheduleId, schedule.id);
    assert.equal(schedule.status, 'sent');
  });

  await run('authenticated fallback does not process another user schedule', async () => {
    const otherUserId = '99999999-9999-4999-8999-999999999999';
    const { sql, schedule, notifications } = createNotificationScheduleSqlMock({ scheduleUserId: otherUserId });
    const token = signToken({ sub: '11111111-1111-4111-8111-111111111111', email: 'pedro@example.com' });
    const response = await handleNotificationProcessDue({
      sql,
      request: {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      },
    });

    assert.equal(response.status, 200);
    const body = response.body as { ok: boolean; notifications: Array<Record<string, unknown>> };
    assert.equal(body.ok, true);
    assert.equal(notifications.length, 0);
    assert.equal(body.notifications.length, 0);
    assert.equal(schedule.status, 'pending');
    assert.equal(schedule.sentAt, null);
  });

  await run('push failure does not block central notification or sent schedule', async () => {
    const previousPublicKey = process.env.VAPID_PUBLIC_KEY;
    const previousPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const keys = webpush.generateVAPIDKeys();

    try {
      process.env.VAPID_PUBLIC_KEY = keys.publicKey;
      process.env.VAPID_PRIVATE_KEY = keys.privateKey;
      const { sql, schedule, notifications } = createNotificationScheduleSqlMock({ failPushLookup: true });
      const result = await processDueNotificationSchedules(sql, 20);

      assert.equal(result.fetchedSchedules, 1);
      assert.equal(result.sentSchedules, 1);
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].sourceScheduleId, schedule.id);
      assert.equal(schedule.status, 'sent');
      assert.notEqual(schedule.sentAt, null);
    } finally {
      if (previousPublicKey === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = previousPublicKey;
      if (previousPrivateKey === undefined) delete process.env.VAPID_PRIVATE_KEY;
      else process.env.VAPID_PRIVATE_KEY = previousPrivateKey;
    }
  });

  await run('slow push does not block due schedule response', async () => {
    const previousPublicKey = process.env.VAPID_PUBLIC_KEY;
    const previousPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const previousPushTimeout = process.env.PUSH_SEND_TIMEOUT_MS;
    const keys = webpush.generateVAPIDKeys();

    try {
      process.env.VAPID_PUBLIC_KEY = keys.publicKey;
      process.env.VAPID_PRIVATE_KEY = keys.privateKey;
      process.env.PUSH_SEND_TIMEOUT_MS = '20';
      const { sql, schedule, notifications } = createNotificationScheduleSqlMock({ slowPushLookupMs: 75 });
      const startedAt = Date.now();
      const result = await processDueNotificationSchedules(sql, 20, 500);
      const durationMs = Date.now() - startedAt;

      assert.equal(result.fetchedSchedules, 1);
      assert.equal(result.sentSchedules, 1);
      assert.equal(result.failedSchedules, 0);
      assert.equal(notifications.length, 1);
      assert.equal(schedule.status, 'sent');
      assert.notEqual(schedule.sentAt, null);
      assert.ok(durationMs < 70, `expected slow push timeout before 70ms, got ${durationMs}ms`);
    } finally {
      if (previousPublicKey === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = previousPublicKey;
      if (previousPrivateKey === undefined) delete process.env.VAPID_PRIVATE_KEY;
      else process.env.VAPID_PRIVATE_KEY = previousPrivateKey;
      if (previousPushTimeout === undefined) delete process.env.PUSH_SEND_TIMEOUT_MS;
      else process.env.PUSH_SEND_TIMEOUT_MS = previousPushTimeout;
    }
  });

  await run('side effect sync creates notification schedule for timed task', async () => {
    const { sql, jobs, schedules, task } = createTaskSideEffectsSqlMock({ dueMinutesFromNow: 5 });
    const result = await processTaskSideEffects(sql, 3, 8000);

    assert.equal(result.sideEffectDiagnostics.duePendingCount, 1);
    assert.equal(result.fetched, 1);
    assert.equal(result.done, 1);
    assert.equal(jobs.find((job) => job.kind === 'sync_notification_schedules')?.status, 'done');
    assert.ok(schedules.some((schedule) => (
      schedule.taskId === task.id &&
      schedule.kind === 'notification' &&
      schedule.status === 'pending'
    )));
  });

  await run('side effect sync creates alarm schedule when alarm is enabled', async () => {
    const { sql, schedules, task } = createTaskSideEffectsSqlMock({
      alarmEnabled: true,
      dueMinutesFromNow: 5,
    });
    const result = await processTaskSideEffects(sql, 3, 8000);

    assert.equal(result.fetched, 1);
    assert.equal(result.done, 1);
    assert.ok(schedules.some((schedule) => (
      schedule.taskId === task.id &&
      schedule.kind === 'alarm' &&
      schedule.status === 'pending'
    )));
    assert.equal(schedules.some((schedule) => (
      schedule.taskId === task.id &&
      schedule.kind === 'notification' &&
      schedule.notifyAt === task.dueDate
    )), false);
  });

  await run('side effect sync creates pre notice when there is enough time', async () => {
    const { sql, schedules, task } = createTaskSideEffectsSqlMock({ dueMinutesFromNow: 30 });
    const result = await processTaskSideEffects(sql, 3, 8000);

    assert.equal(result.fetched, 1);
    assert.equal(result.done, 1);
    assert.ok(schedules.some((schedule) => schedule.taskId === task.id && schedule.kind === 'pre_notice'));
    assert.ok(schedules.some((schedule) => schedule.taskId === task.id && schedule.kind === 'notification'));
  });

  await run('side effect sync skips pre notice when due date is too close', async () => {
    const { sql, schedules, task } = createTaskSideEffectsSqlMock({ dueMinutesFromNow: 5 });
    const result = await processTaskSideEffects(sql, 3, 8000);

    assert.equal(result.fetched, 1);
    assert.equal(result.done, 1);
    assert.equal(schedules.some((schedule) => schedule.taskId === task.id && schedule.kind === 'pre_notice'), false);
    assert.ok(schedules.some((schedule) => schedule.taskId === task.id && schedule.kind === 'notification'));
  });

  await run('side effect diagnostics expose due pending age', async () => {
    const { sql } = createTaskSideEffectsSqlMock({ dueMinutesFromNow: 5 });
    const result = await processTaskSideEffects(sql, 1, 8000);

    assert.equal(result.sideEffectDiagnostics.duePendingCount, 1);
    assert.equal(result.sideEffectDiagnostics.dueByKind.sync_notification_schedules, 1);
    assert.equal(result.sideEffectDiagnostics.oldestPendingAgeSeconds, 0);
  });

  await run('backfill creates schedule for pending timed task without active schedules', async () => {
    const { sql, schedules, task } = createTaskSideEffectsSqlMock({ dueMinutesFromNow: 20 });
    const result = await backfillMissingNotificationSchedules(sql, 3, 8000, { ensureInfrastructure: false });

    assert.equal(result.backfilledSchedules, 2);
    assert.equal(result.backfillDiagnostics.scannedTasks, 1);
    assert.equal(result.backfillDiagnostics.missingSchedules, 1);
    assert.ok(schedules.some((schedule) => schedule.taskId === task.id && schedule.kind === 'pre_notice'));
    assert.ok(schedules.some((schedule) => schedule.taskId === task.id && schedule.kind === 'notification'));
  });

  await run('overdue scheduling catches up missed overdue reminder immediately', async () => {
    const { sql, schedules, task } = createTaskSideEffectsSqlMock({ dueMinutesFromNow: -20 });
    const dueDate = '2026-05-14T14:40:00.000Z';
    const notBefore = new Date('2026-05-14T15:00:00.000Z');
    const created = await scheduleOverdueRemindersForTask(sql, {
      ...task,
      dueDate,
      reminderMode: 'timed' as const,
      status: 'overdue',
      overdueSince: dueDate,
      overdueExpiresAt: new Date(notBefore.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    }, {
      maxSchedules: 1,
      notBefore,
    });

    const schedule = schedules.find((item) => item.kind === 'overdue_reminder');
    assert.equal(created, 1);
    assert.ok(schedule);
    assert.equal(schedule?.taskId, task.id);
    assert.equal(schedule?.notifyAt, notBefore.toISOString());
  });

  await run('calendar side effect does not outrank notification schedule sync', async () => {
    const { sql, jobs, schedules } = createTaskSideEffectsSqlMock({
      includeExternalCalendarJob: true,
      externalFirst: true,
      dueMinutesFromNow: 5,
    });
    const result = await processTaskSideEffects(sql, 1, 8000);

    assert.equal(result.sideEffectDiagnostics.duePendingCount, 2);
    assert.equal(result.fetched, 1);
    assert.equal(result.done, 1);
    assert.equal(jobs.find((job) => job.kind === 'sync_notification_schedules')?.status, 'done');
    assert.equal(jobs.find((job) => job.kind === 'sync_external_calendar')?.status, 'pending');
    assert.ok(schedules.some((schedule) => schedule.kind === 'notification'));
  });

  await run('external calendar side effect completes without claiming notification side effects', async () => {
    const { sql, jobs } = createTaskSideEffectsSqlMock({
      includeExternalCalendarJob: true,
      dueMinutesFromNow: 5,
    });
    const result = await processExternalCalendarSideEffects(sql, 1, 8000);

    assert.equal(result.scanned, 1);
    assert.equal(result.synced, 1);
    assert.equal(jobs.find((job) => job.kind === 'sync_external_calendar')?.status, 'done');
    assert.equal(jobs.find((job) => job.kind === 'sync_notification_schedules')?.status, 'pending');
  });

  await run('sync_external_calendar without active integration does not stay pending', async () => {
    const { sql, jobs } = createTaskSideEffectsSqlMock({
      includeExternalCalendarJob: true,
      includeNotificationJob: false,
      dueMinutesFromNow: 5,
    });
    const result = await processExternalCalendarSideEffects(sql, 1, 8000);
    const job = jobs.find((item) => item.kind === 'sync_external_calendar');

    assert.equal(result.scanned, 1);
    assert.equal(result.synced, 1);
    assert.equal(job?.status, 'done');
    assert.notEqual(job?.doneAt, null);
    assert.equal(job?.failedAt, null);
  });

  await run('external calendar side effect timeout fails with clear error', async () => {
    const { sql, jobs, task } = createTaskSideEffectsSqlMock({
      includeExternalCalendarJob: true,
      includeNotificationJob: false,
      hangExternalCalendarIntegrations: true,
      dueMinutesFromNow: 5,
    });
    const startedAt = Date.now();
    const result = await processExternalCalendarSideEffects(sql, 1, 60);
    const durationMs = Date.now() - startedAt;
    const job = jobs.find((item) => item.kind === 'sync_external_calendar');

    assert.equal(result.scanned, 1);
    assert.equal(result.failed, 1);
    assert.equal(job?.status, 'failed');
    assert.equal(job?.attempts, 1);
    assert.match(String(job?.errorMessage), /sync_external_calendar_timeout_after_/);
    assert.equal(task.externalCalendarSyncStatus, 'failed');
    assert.match(String(task.externalCalendarLastError), /sync_external_calendar_timeout_after_/);
    assert.ok(durationMs < 250, `expected external calendar timeout before 250ms, got ${durationMs}ms`);
  });

  await run('cron processes due schedules before side effects', () => {
    const cronHandler = readFileSync(new URL('../lib/handlers/notifications.ts', import.meta.url), 'utf8');
    const dueIndex = cronHandler.indexOf('processDueNotificationSchedules(');
    const sideEffectIndex = cronHandler.indexOf('processTaskSideEffects(sql');

    assert.ok(dueIndex >= 0);
    assert.ok(sideEffectIndex >= 0);
    assert.ok(dueIndex < sideEffectIndex);
  });

  await run('cron handler has global deadline and nested schedule response', () => {
    const cronHandler = readFileSync(new URL('../lib/handlers/notifications.ts', import.meta.url), 'utf8');

    assert.ok(cronHandler.includes('const MAX_CRON_RESPONSE_MS = 20000;'));
    assert.ok(cronHandler.includes('function withTimeout'));
    assert.ok(cronHandler.includes("stage: 'processDueNotificationSchedules'") || cronHandler.includes("'processDueNotificationSchedules'"));
    assert.ok(cronHandler.includes("'processTaskSideEffects'"));
    assert.ok(cronHandler.includes("'backfillMissingNotificationSchedules'"));
    assert.ok(cronHandler.includes("'processExternalCalendarSideEffects'"));
    assert.ok(cronHandler.includes("'detectOverdueNotificationSchedules'"));
    assert.ok(cronHandler.includes('const schedules = {'));
    assert.ok(cronHandler.includes('return json(200, {'));
    assert.ok(cronHandler.includes('schedules,'));
    assert.ok(cronHandler.includes('precomputedDiagnostics: preliminaryScheduleDiagnostics'));
    assert.ok(cronHandler.includes('reclaimStuckProcessing: false'));
    assert.ok(cronHandler.includes('notificationSchedulesOnly: true'));
    assert.ok(cronHandler.includes('precomputedDiagnostics: preliminarySideEffectDiagnostics'));
    assert.ok(cronHandler.includes('backfillDiagnostics'));
  });

  await run('reminder scheduler workflow has safe logs and authenticated cron call', () => {
    const workflow = readFileSync(new URL('../.github/workflows/reminder-scheduler.yml', import.meta.url), 'utf8');

    assert.match(workflow, /cron: "2-59\/5 \* \* \* \*"/);
    assert.match(workflow, /APP_URL: https:\/\/lembreto\.vercel\.app/);
    assert.match(workflow, /CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/);
    assert.match(workflow, /Authorization: Bearer \$CRON_SECRET/);
    assert.match(workflow, /utc_now=/);
    assert.match(workflow, /event_name=/);
    assert.match(workflow, /branch=/);
    assert.match(workflow, /app_host=/);
    assert.match(workflow, /http_status=/);
    assert.match(workflow, /response_ms=/);
    assert.match(workflow, /scheduleDuePendingCount/);
    assert.doesNotMatch(workflow, /echo .*CRON_SECRET/);
    assert.doesNotMatch(workflow, /set -x/);
  });

  await run('task creation enqueues notification schedule side effect before calendar sync', () => {
    const taskHandler = readFileSync(new URL('../lib/handlers/tasks.ts', import.meta.url), 'utf8');
    const scheduleIndex = taskHandler.indexOf('await enqueueScheduleSync(sql, user.id, taskId)');
    const calendarIndex = taskHandler.indexOf('await enqueueCalendarSync(sql, user.id, taskId)');

    assert.ok(scheduleIndex >= 0);
    assert.ok(calendarIndex >= 0);
    assert.ok(scheduleIndex < calendarIndex);
  });

  await run('cron health endpoint returns lightweight db timings', async () => {
    const previousSecret = process.env.CRON_SECRET;
    const { handleCronHealth } = await import('../lib/handlers/notifications.js');

    try {
      process.env.CRON_SECRET = 'test-cron-secret';
      const response = await handleCronHealth({
        sql: createCronHealthSqlMock({
          taskSideEffectsPending: 2,
          taskSideEffectsDue: 1,
          schedulesPending: 3,
          schedulesDue: 1,
          tasksPending: 4,
        }),
        request: {
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        },
      });

      assert.equal(response.status, 200);
      const body = response.body as {
        ok?: boolean;
        db?: { nowMs?: number | null; taskSideEffectsPendingMs?: number | null; schedulesDueMs?: number | null };
        counts?: { taskSideEffectsPending?: number | null; schedulesDue?: number | null; tasksPending?: number | null };
      };
      assert.equal(body.ok, true);
      assert.equal(typeof body.db?.nowMs, 'number');
      assert.equal(typeof body.db?.taskSideEffectsPendingMs, 'number');
      assert.equal(typeof body.db?.schedulesDueMs, 'number');
      assert.equal(body.counts?.taskSideEffectsPending, 2);
      assert.equal(body.counts?.schedulesDue, 1);
      assert.equal(body.counts?.tasksPending, 4);
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
    }
  });

  await run('cron health endpoint times out quickly when first query hangs', async () => {
    const previousSecret = process.env.CRON_SECRET;
    const previousHealthTimeout = process.env.CRON_DB_HEALTH_QUERY_TIMEOUT_MS;
    const { handleCronHealth } = await import('../lib/handlers/notifications.js');

    try {
      process.env.CRON_SECRET = 'test-cron-secret';
      process.env.CRON_DB_HEALTH_QUERY_TIMEOUT_MS = '30';
      const startedAt = Date.now();
      const response = await handleCronHealth({
        sql: createCronHealthSqlMock({ neverNow: true }),
        request: {
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        },
      });
      const durationMs = Date.now() - startedAt;

      assert.equal(response.status, 200);
      assert.ok(durationMs < 200, `expected health timeout before 200ms, got ${durationMs}ms`);
      const body = response.body as { ok?: boolean; steps?: { now?: { ok?: boolean; error?: string } } };
      assert.equal(body.ok, false);
      assert.equal(body.steps?.now?.ok, false);
      assert.match(body.steps?.now?.error ?? '', /timeout/);
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
      if (previousHealthTimeout === undefined) delete process.env.CRON_DB_HEALTH_QUERY_TIMEOUT_MS;
      else process.env.CRON_DB_HEALTH_QUERY_TIMEOUT_MS = previousHealthTimeout;
    }
  });

  await run('cron returns preliminary diagnostics when processing stages have no rows', async () => {
    const previousSecret = process.env.CRON_SECRET;
    const previousMaintenance = process.env.CRON_ENABLE_MAINTENANCE_STAGES;
    const { handleNotificationsCron } = await import('../lib/handlers/notifications.js');

    try {
      process.env.CRON_SECRET = 'test-cron-secret';
      delete process.env.CRON_ENABLE_MAINTENANCE_STAGES;
      const response = await handleNotificationsCron({
        sql: createCronHealthSqlMock({
          taskSideEffectsPending: 2,
          taskSideEffectsDue: 1,
          schedulesPending: 3,
          schedulesDue: 1,
          tasksPending: 4,
        }),
        request: {
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        },
      });

      assert.equal(response.status, 200);
      const body = response.body as {
        scheduleDiagnostics?: { duePendingCount?: number };
        sideEffectDiagnostics?: { duePendingCount?: number };
        backfill?: { skippedReason?: string };
        calendarSync?: { skippedReason?: string };
      };
      assert.equal(body.scheduleDiagnostics?.duePendingCount, 1);
      assert.equal(body.sideEffectDiagnostics?.duePendingCount, 1);
      assert.equal(body.backfill?.skippedReason, 'disabled_in_notification_cron');
      assert.equal(body.calendarSync?.skippedReason, 'no_external_calendar_side_effects_due');
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
      if (previousMaintenance === undefined) delete process.env.CRON_ENABLE_MAINTENANCE_STAGES;
      else process.env.CRON_ENABLE_MAINTENANCE_STAGES = previousMaintenance;
    }
  });

  await run('cron handler returns JSON when a stage never resolves', async () => {
    const previousSecret = process.env.CRON_SECRET;
    const previousBudget = process.env.CRON_MAX_RESPONSE_MS;
    const previousHealthTimeout = process.env.CRON_DB_HEALTH_QUERY_TIMEOUT_MS;

    try {
      process.env.CRON_SECRET = 'test-cron-secret';
      process.env.CRON_MAX_RESPONSE_MS = '1000';
      process.env.CRON_DB_HEALTH_QUERY_TIMEOUT_MS = '30';
      const { handleNotificationsCron } = await import('../lib/handlers/notifications.js');
      const neverSql = (() => new Promise<Array<Record<string, unknown>>>(() => undefined)) as SqlClient;
      const startedAt = Date.now();
      const response = await handleNotificationsCron({
        sql: neverSql,
        request: {
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        },
      });
      const durationMs = Date.now() - startedAt;

      assert.equal(response.status, 200);
      assert.ok(durationMs < 300, `expected cron db-health fallback before 300ms, got ${durationMs}ms`);
      const body = response.body as {
        ok?: boolean;
        stoppedByTimeLimit?: boolean;
        hasMore?: boolean;
        skippedByDbHealth?: boolean;
        schedules?: { fetched?: number; sent?: number; stoppedByTimeLimit?: boolean };
      };
      assert.equal(body.ok, true);
      assert.equal(body.stoppedByTimeLimit, false);
      assert.equal(body.hasMore, true);
      assert.equal(body.skippedByDbHealth, true);
      assert.equal(body.schedules?.fetched, 0);
      assert.equal(body.schedules?.sent, 0);
      assert.equal(body.schedules?.stoppedByTimeLimit, false);
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
      if (previousBudget === undefined) delete process.env.CRON_MAX_RESPONSE_MS;
      else process.env.CRON_MAX_RESPONSE_MS = previousBudget;
      if (previousHealthTimeout === undefined) delete process.env.CRON_DB_HEALTH_QUERY_TIMEOUT_MS;
      else process.env.CRON_DB_HEALTH_QUERY_TIMEOUT_MS = previousHealthTimeout;
    }
  });

  console.log('PASS all tests');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
