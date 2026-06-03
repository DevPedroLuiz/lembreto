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
import {
  buildOverdueExpiresAt,
  buildOverdueScheduleOffsets,
  getOverdueReminderSequence,
} from '../lib/overdue-reminders.js';
import { getDerivedTaskStatus, getDerivedTaskStatusLabel } from '../src/lib/taskStatus.ts';

process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters';

function getInfrastructureCheckRows(query: string) {
  if (query.includes('pg_catalog.pg_constraint')) {
    return [{
      definition: [
        'pending',
        'overdue',
        'completed',
        'draft',
        'inactive',
        'cancelled',
        'idle',
        'synced',
        'failed',
        'manual',
        'expired',
      ].join(' '),
    }];
  }

  if (query.includes('pg_catalog.pg_class') || query.includes('pg_catalog.pg_attribute')) {
    return [{ exists: 1 }];
  }

  return null;
}

function createSqlMock(options?: { blacklisted?: boolean; missingUser?: boolean }) {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ');
    const infrastructureRows = getInfrastructureCheckRows(query);
    if (infrastructureRows) return infrastructureRows;

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

function createAssistantSqlMock() {
  const userId = '11111111-1111-4111-8111-111111111111';
  const tasks: Array<Record<string, unknown>> = [];
  const notes: Array<Record<string, unknown>> = [];
  const conversations: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const actionEvents: Array<Record<string, unknown>> = [];
  const contextRefs: Array<Record<string, unknown>> = [];

  const normalizeJson = (value: unknown) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }
    return value ?? {};
  };

  const filterAssistantTasks = (values: unknown[]) => {
    const statusFilter = values.includes('overdue')
      ? 'overdue'
      : values.includes('pending')
        ? 'pending'
        : values.includes('completed')
          ? 'completed'
          : null;
    const pattern = values.find((value) => typeof value === 'string' && String(value).startsWith('%'));
    const search = typeof pattern === 'string' ? pattern.replace(/%/g, '') : null;
    const dates = values
      .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))
      .map((value) => Date.parse(value))
      .filter((value) => Number.isFinite(value));
    const dueStart = dates[0];
    const dueEnd = dates[1];
    const now = Date.now();

    return tasks.filter((task) => {
      if (task.deletedAt) return false;
      if (task.status === 'cancelled') return false;

      const dueTime = typeof task.dueDate === 'string' && task.dueDate
        ? Date.parse(task.dueDate)
        : Number.NaN;
      const hasDueTime = Number.isFinite(dueTime);
      if (statusFilter === 'completed' && task.status !== 'completed') return false;
      if (statusFilter === 'overdue' && !(task.status === 'pending' || task.status === 'overdue')) return false;
      if (statusFilter === 'overdue' && (!hasDueTime || dueTime >= now)) return false;
      if (statusFilter === 'pending' && !(task.status === 'pending' || task.status === 'overdue')) return false;
      if (statusFilter === 'pending' && hasDueTime && dueTime < now) return false;
      if (dueStart !== undefined && (!hasDueTime || dueTime < dueStart)) return false;
      if (dueEnd !== undefined && (!hasDueTime || dueTime > dueEnd)) return false;
      if (search && !String(task.title).toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  };

  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ');
    const infrastructureRows = getInfrastructureCheckRows(query);
    if (infrastructureRows) return infrastructureRows;

    if (query.includes('FROM token_blacklist')) return [];

    if (query.includes('FROM users')) {
      return [{
        id: values[0],
        name: 'Pedro',
        email: 'pedro@example.com',
        avatar: null,
      }];
    }

    if (query.includes('INSERT INTO assistant_conversations')) {
      const conversation = {
        id: values[0],
        userId: values[1],
        title: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
      };
      conversations.push(conversation);
      return [conversation];
    }

    if (query.includes('FROM assistant_conversations')) {
      const id = values[0];
      const scopedUserId = values[1];
      return conversations.filter((conversation) => (
        conversation.id === id &&
        conversation.userId === scopedUserId &&
        !conversation.archivedAt
      ));
    }

    if (query.includes('INSERT INTO assistant_messages')) {
      const message = {
        id: values[0],
        conversationId: values[1],
        userId: values[2],
        role: values[3],
        content: values[4],
        metadata: normalizeJson(values[5]),
        createdAt: new Date().toISOString(),
      };
      messages.push(message);
      return [message];
    }

    if (query.includes('UPDATE assistant_conversations')) {
      const id = values[0];
      const conversation = conversations.find((item) => item.id === id);
      if (conversation) conversation.updatedAt = new Date().toISOString();
      return [];
    }

    if (query.includes('FROM assistant_messages')) {
      const conversationId = values[0];
      const hasUserFilter = query.includes('AND user_id');
      const scopedUserId = hasUserFilter ? values[1] : undefined;
      const limit = Number(values[hasUserFilter ? 2 : 1] ?? 12);
      return messages
        .filter((message) => (
          message.conversationId === conversationId &&
          (!hasUserFilter || message.userId === scopedUserId)
        ))
        .slice(-limit)
        .reverse();
    }

    if (query.includes('INSERT INTO assistant_action_events')) {
      const event = {
        id: values[0],
        conversationId: values[1],
        userId: values[2],
        messageId: values[3],
        actionType: values[4],
        status: values[5],
        entityType: values[6],
        entityId: values[7],
        entityTitle: values[8],
        summary: values[9],
        payload: normalizeJson(values[10]),
        createdAt: new Date().toISOString(),
      };
      actionEvents.push(event);
      return [event];
    }

    if (query.includes('FROM assistant_action_events')) {
      const conversationId = values[0];
      const hasUserFilter = query.includes('AND user_id');
      const scopedUserId = hasUserFilter ? values[1] : undefined;
      const limit = Number(values[hasUserFilter ? 2 : 1] ?? 10);
      return actionEvents
        .filter((event) => (
          event.conversationId === conversationId &&
          (!hasUserFilter || event.userId === scopedUserId)
        ))
        .slice(-limit)
        .reverse();
    }

    if (query.includes('INSERT INTO assistant_context_refs')) {
      const ref = {
        id: values[0],
        conversationId: values[1],
        userId: values[2],
        refKey: values[3],
        entityType: values[4],
        entityId: values[5],
        entityTitle: values[6],
        metadata: normalizeJson(values[7]),
        expiresAt: values[8],
        createdAt: new Date().toISOString(),
      };
      contextRefs.push(ref);
      return [ref];
    }

    if (query.includes('FROM assistant_context_refs')) {
      const conversationId = values[0];
      const hasUserFilter = query.includes('AND user_id');
      const scopedUserId = hasUserFilter ? values[1] : undefined;
      const latest = new Map<string, Record<string, unknown>>();
      for (const ref of contextRefs.filter((item) => (
        item.conversationId === conversationId &&
        (!hasUserFilter || item.userId === scopedUserId)
      )).reverse()) {
        if (!latest.has(String(ref.refKey))) latest.set(String(ref.refKey), ref);
      }
      return Array.from(latest.values()).slice(0, Number(values[hasUserFilter ? 2 : 1] ?? 10));
    }

    if (query.includes('INSERT INTO tasks')) {
      const task = {
        id: '22222222-2222-4222-8222-222222222222',
        userId: values[0],
        clientMutationId: values[1],
        title: values[2],
        description: values[3],
        dueDate: values[4],
        endDate: values[5],
        priority: values[6],
        category: values[7],
        tags: values[8],
        suppressHolidayNotifications: values[9],
        overdueReminderIntensity: values[10],
        alarmEnabled: values[11],
        preNoticeMinutes: values[12],
        reminderMode: values[13],
        expiresAt: values[14],
        overdueSince: null,
        overdueExpiresAt: null,
        deletedAt: null,
        completedAt: null,
        completionSource: null,
        autoDeletedReason: null,
        autoDeletedAt: null,
        mutedUntil: values[15],
        status: values[17],
        history: [],
        createdAt: new Date().toISOString(),
        externalCalendarProvider: null,
        externalCalendarEventId: null,
        externalCalendarSyncStatus: 'idle',
        externalCalendarLastError: null,
        externalCalendarSyncedAt: null,
      };
      tasks.unshift(task);
      return [task];
    }

    if (query.includes('SELECT COUNT(*) AS total') && query.includes('FROM tasks')) {
      return [{ total: filterAssistantTasks(values).length }];
    }

    if (query.includes('FROM tasks') && query.includes('ORDER BY')) {
      return filterAssistantTasks(values);
    }

    if (query.includes('FROM tasks') && query.includes('WHERE id')) {
      const id = values[0];
      return tasks.filter((task) => task.id === id);
    }

    if (query.includes('UPDATE tasks SET')) {
      const id = values[values.length - 2];
      const task = tasks.find((item) => item.id === id);
      if (!task) return [];
      Object.assign(task, {
        title: values[0],
        description: values[1],
        dueDate: values[2],
        endDate: values[3],
        priority: values[4],
        category: values[5],
        tags: values[6],
        suppressHolidayNotifications: values[7],
        overdueReminderIntensity: values[8],
        alarmEnabled: values[9],
        mutedUntil: values[10],
        status: values.find((value) => (
          value === 'pending' ||
          value === 'completed' ||
          value === 'inactive' ||
          value === 'cancelled'
        )) ?? task.status,
      });
      return [task];
    }

    if (query.includes('INSERT INTO notes')) {
      const note = {
        id: '33333333-3333-4333-8333-333333333333',
        userId: values[0],
        taskId: values[1],
        title: values[2],
        content: values[3],
        priority: values[4],
        category: values[5],
        tags: values[6],
        mode: values[7],
        expiresAt: values[8],
        deletedAt: null,
        deleteAfter: null,
        deletionReason: null,
        expiredNotificationSentAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      notes.unshift(note);
      return [note];
    }

    return [];
  }) as SqlClient;

  return { sql, userId, tasks, notes, conversations, messages, actionEvents, contextRefs };
}

async function withMockedGeminiResponse<T>(
  action: unknown,
  fn: (requests: unknown[]) => Promise<T>,
): Promise<T> {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  const requests: unknown[] = [];

  try {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string') {
        try {
          requests.push(JSON.parse(init.body));
        } catch {
          requests.push(init.body);
        }
      }

      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify(action) }],
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    return await fn(requests);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
}

function createNotificationScheduleSqlMock(options?: {
  future?: boolean;
  kind?: 'pre_notice' | 'notification' | 'alarm' | 'floating_reminder' | 'overdue_reminder';
  taskDueMinutesFromNow?: number;
  failPushLookup?: boolean;
  slowPushLookupMs?: number;
  scheduleUserId?: string;
  existingNotification?: boolean;
  notificationsEnabled?: boolean;
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
    title: kind === 'pre_notice' ? 'Lembrete em 15 minutos' : 'Está na hora',
    message: kind === 'pre_notice' ? '"Teste" começa em breve.' : '"Teste" chegou ao horário definido.',
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
    const infrastructureRows = getInfrastructureCheckRows(query);
    if (infrastructureRows) return infrastructureRows;

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
        notificationsEnabled: options?.notificationsEnabled ?? true,
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
      const scheduleId = String(values[6] ?? '');
      const canUpdate = schedule.id === scheduleId && (
        !['sent', 'failed'].includes(status) ||
        (schedule.status === 'processing' && schedule.cancelledAt === null)
      );
      if (!canUpdate) return [];

      schedule.status = status;
      schedule.sentAt = status === 'sent' ? now.toISOString() : schedule.sentAt;
      schedule.failedAt = status === 'failed' ? now.toISOString() : schedule.failedAt;
      schedule.cancelledAt = status === 'cancelled' ? now.toISOString() : schedule.cancelledAt;
      schedule.processingStartedAt = null;
      schedule.errorMessage = values.includes('notifications_disabled')
        ? 'notifications_disabled'
        : typeof values[5] === 'string'
          ? values[5]
          : null;
      return [rowForSchedule()];
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

function createPushDeliverySqlMock() {
  const userId = '11111111-1111-4111-8111-111111111111';
  const notificationId = '44444444-4444-4444-8444-444444444444';
  const subscriptions = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      endpoint: 'https://push.example.test/success',
      p256dh: 'p256dh-success',
      auth: 'auth-success',
      userAgent: 'Browser A',
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      endpoint: 'https://push.example.test/fail',
      p256dh: 'p256dh-fail',
      auth: 'auth-fail',
      userAgent: 'Browser B',
    },
  ];
  const deliveries: Array<Record<string, unknown>> = [];

  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(' ');

    if (query.includes('FROM push_subscriptions')) {
      return subscriptions.filter((subscription) => subscription.id && values.includes(userId));
    }

    if (query.includes('INSERT INTO notification_deliveries')) {
      let delivery = deliveries.find((item) => (
        item.notificationId === values[0] &&
        item.endpointHash === values[3]
      ));
      if (!delivery) {
        delivery = {
          id: crypto.randomUUID(),
          notificationId: values[0],
          userId: values[1],
          pushSubscriptionId: values[2],
          endpointHash: values[3],
          endpoint: values[4],
          userAgent: values[5],
          status: 'attempted',
          attemptCount: 1,
          lastError: null,
        };
        deliveries.push(delivery);
      } else {
        delivery.pushSubscriptionId = values[2];
        delivery.endpoint = values[4];
        delivery.userAgent = values[5];
        delivery.status = 'attempted';
        delivery.attemptCount = Number(delivery.attemptCount ?? 0) + 1;
        delivery.lastError = null;
      }
      return [{ id: delivery.id }];
    }

    if (query.includes('UPDATE notification_deliveries')) {
      const status = String(values[0]);
      const lastError = values.find((value) => typeof value === 'string' && String(value).includes('simulated')) ?? null;
      const deliveryId = String(values[4]);
      const delivery = deliveries.find((item) => item.id === deliveryId);
      if (delivery) {
        delivery.status = status;
        delivery.lastError = lastError;
      }
      return [];
    }

    return [];
  }) as SqlClient;

  return {
    sql,
    userId,
    notificationId,
    subscriptions,
    deliveries,
  };
}

function createTaskSideEffectsSqlMock(options?: {
  alarmEnabled?: boolean;
  preNoticeMinutes?: number | null;
  dueMinutesFromNow?: number;
  includeExternalCalendarJob?: boolean;
  includeNotificationJob?: boolean;
  externalFirst?: boolean;
  hangExternalCalendarIntegrations?: boolean;
  notificationsEnabled?: boolean;
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
    endDate: dueDate.toISOString(),
    priority: 'medium',
    category: 'Geral',
    status: 'pending',
    createdAt: new Date(now.getTime() - 60_000).toISOString(),
    alarmEnabled: Boolean(options?.alarmEnabled),
    preNoticeMinutes: options?.preNoticeMinutes ?? null,
    reminderMode: 'timed',
    expiresAt: null,
    overdueSince: null,
    overdueExpiresAt: null,
    deletedAt: null,
    completedAt: null,
    mutedUntil: null,
    suppressHolidayNotifications: false,
    overdueReminderIntensity: 'normal' as const,
    floatingIntervalMinutes: null,
    notificationsEnabled: options?.notificationsEnabled ?? true,
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
    const infrastructureRows = getInfrastructureCheckRows(query);
    if (infrastructureRows) return infrastructureRows;

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
        preNoticeMinutes: task.preNoticeMinutes,
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
  schedulesProcessing?: number;
  schedulesStuckProcessing?: number;
  tasksPending?: number;
  overdueCandidates?: number;
}) {
  const now = new Date('2026-05-14T21:30:00.000Z');
  const sql = (async (strings: TemplateStringsArray) => {
    const query = strings.join(' ');
    const infrastructureRows = getInfrastructureCheckRows(query);
    if (infrastructureRows) return infrastructureRows;

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

    if (query.includes('WITH due AS') && query.includes('UPDATE task_side_effects tse')) {
      return [];
    }

    if (query.includes('WITH due AS') && query.includes('UPDATE notification_schedules ns')) {
      return [];
    }

    if (query.includes('WITH stuck AS') && query.includes('UPDATE notification_schedules')) {
      const count = Math.min(options?.schedulesStuckProcessing ?? 0, 2);
      return Array.from({ length: count }, (_, index) => ({ id: `stuck-${index}` }));
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

    if (query.includes('FROM notification_schedules') && query.includes('"stuckProcessingCount"')) {
      return [{
        processingCount: options?.schedulesProcessing ?? 0,
        stuckProcessingCount: options?.schedulesStuckProcessing ?? 0,
      }];
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

function createCronPostSideEffectScheduleSqlMock() {
  const userId = '11111111-1111-4111-8111-111111111111';
  const taskId = '22222222-2222-4222-8222-222222222222';
  const dbNow = new Date(Date.now() + 2_000);
  const taskDueDate = new Date(Date.now() + 1_000);
  const job = {
    id: '77777777-7777-4777-8777-777777777777',
    userId,
    taskId,
    kind: 'sync_notification_schedules',
    attempts: 0,
    dedupeKey: `user:${userId}:task:${taskId}:sync-schedules`,
    status: 'pending',
    availableAt: new Date(Date.now() - 1_000).toISOString(),
    createdAt: new Date(Date.now() - 1_000).toISOString(),
    processingStartedAt: null as string | null,
    doneAt: null as string | null,
    failedAt: null as string | null,
    cancelledAt: null as string | null,
    errorMessage: null as string | null,
  };
  const schedules: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];

  const pendingSchedules = () => schedules.filter((schedule) => schedule.status === 'pending');
  const dueSchedules = () => pendingSchedules().filter((schedule) => (
    new Date(String(schedule.notifyAt)) <= dbNow &&
    schedule.sentAt === null &&
    schedule.failedAt === null &&
    schedule.cancelledAt === null
  ));
  const scheduleRow = (schedule: Record<string, unknown>) => ({
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
  const notificationRow = (notification: Record<string, unknown>) => ({
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
    const infrastructureRows = getInfrastructureCheckRows(query);
    if (infrastructureRows) return infrastructureRows;

    if (query.includes('SELECT NOW() AS now')) return [{ now: dbNow.toISOString() }];
    if (query.includes('SELECT NOW() AS "postgresNow"')) return [{ postgresNow: dbNow.toISOString() }];

    if (query.includes('FROM task_side_effects') && query.includes('GROUP BY kind')) {
      return job.status === 'pending' ? [{ kind: job.kind, count: 1 }] : [];
    }

    if (query.includes('SELECT COUNT(*) AS count') && query.includes('FROM task_side_effects')) {
      const notificationOnly = query.includes("kind IN ('sync_notification_schedules', 'cancel_notification_schedules')");
      const dueOnly = query.includes('available_at <= NOW()');
      const matches = job.status === 'pending' &&
        (!dueOnly || new Date(job.availableAt) <= dbNow) &&
        (!notificationOnly || job.kind === 'sync_notification_schedules');
      return [{ count: matches ? 1 : 0 }];
    }

    if (query.includes('FROM task_side_effects') && query.includes('MIN(available_at)')) {
      const due = job.status === 'pending' && new Date(job.availableAt) <= dbNow;
      return [{
        postgresNow: dbNow.toISOString(),
        oldestPendingAvailableAt: job.status === 'pending' ? job.availableAt : null,
        duePendingCount: due ? 1 : 0,
        processingCount: job.status === 'processing' ? 1 : 0,
        failedCount: job.status === 'failed' ? 1 : 0,
        doneCount: job.status === 'done' ? 1 : 0,
        oldestPendingAgeSeconds: due ? 1 : null,
      }];
    }

    if (query.includes('WITH due AS') && query.includes('UPDATE task_side_effects tse')) {
      if (job.status !== 'pending' || new Date(job.availableAt) > dbNow) return [];
      job.status = 'processing';
      job.processingStartedAt = dbNow.toISOString();
      return [{
        id: job.id,
        userId: job.userId,
        taskId: job.taskId,
        kind: job.kind,
        attempts: job.attempts,
        dedupeKey: job.dedupeKey,
      }];
    }

    if (query.includes('UPDATE task_side_effects') && query.includes('done_at = CASE')) {
      const status = String(values[0]);
      job.status = status;
      job.processingStartedAt = null;
      job.doneAt = status === 'done' ? dbNow.toISOString() : job.doneAt;
      job.failedAt = status === 'failed' ? dbNow.toISOString() : job.failedAt;
      job.errorMessage = typeof values[7] === 'string' ? values[7] : null;
      return [];
    }

    if (query.includes('FROM notification_schedules') && query.includes('GROUP BY kind')) {
      const dueOnly = query.includes('notify_at <= NOW()');
      const source = dueOnly ? dueSchedules() : pendingSchedules();
      const counts = new Map<string, number>();
      for (const schedule of source) {
        const kind = String(schedule.kind);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([kind, count]) => ({ kind, count }));
    }

    if (query.includes('SELECT COUNT(*) AS count FROM notification_schedules WHERE status =')) {
      const statusFromQuery = query.match(/status = '([^']+)'/)?.[1] ?? String(values[0] ?? '');
      return [{ count: schedules.filter((schedule) => schedule.status === statusFromQuery).length }];
    }

    if (query.includes('SELECT COUNT(*) AS count') && query.includes('FROM notification_schedules')) {
      if (query.includes('notify_at <= NOW()')) return [{ count: dueSchedules().length }];
      return [{ count: pendingSchedules().length }];
    }

    if (query.includes('MIN(notify_at)')) {
      return [{
        postgresNow: dbNow.toISOString(),
        oldestPendingNotifyAt: pendingSchedules().map((schedule) => String(schedule.notifyAt)).sort()[0] ?? null,
        duePendingCount: dueSchedules().length,
        futurePendingCount: pendingSchedules().length - dueSchedules().length,
      }];
    }

    if (query.includes('FROM notification_schedules') && query.includes('LIMIT 5')) {
      return dueSchedules().slice(0, 5).map((schedule) => ({
        id: schedule.id,
        kind: schedule.kind,
        notifyAt: schedule.notifyAt,
        status: schedule.status,
        taskId: schedule.taskId,
      }));
    }

    if (query.includes('WITH stuck AS') && query.includes('UPDATE notification_schedules')) return [];

    if (query.includes('WITH due AS') && query.includes('UPDATE notification_schedules ns')) {
      const claimed = dueSchedules().slice(0, 5);
      for (const schedule of claimed) {
        schedule.status = 'processing';
        schedule.processingStartedAt = dbNow.toISOString();
      }
      return claimed.map(scheduleRow);
    }

    if (query.includes('FROM tasks') && query.includes('INNER JOIN users')) {
      return [{
        id: taskId,
        userId,
        title: 'Teste perto do horario',
        description: '',
        dueDate: taskDueDate.toISOString(),
        status: 'pending',
        createdAt: new Date(Date.now() - 60_000).toISOString(),
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

    if (query.includes('SELECT 1') && query.includes('FROM tasks')) return [{ exists: 1 }];

    if (query.includes('FROM tasks') && query.includes('due_date < NOW()')) return [{ count: 0 }];
    if (query.includes('FROM tasks')) return [{ count: 1 }];

    if (query.includes('UPDATE tasks') && query.includes('reminder_mode')) return [];
    if (query.includes('UPDATE notification_schedules') && query.includes("status = 'cancelled'")) return [];

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
        sequenceIndex: values[8],
        intervalMinutes: values[9],
        status: 'pending',
        sentAt: null,
        failedAt: null,
        cancelledAt: null,
        processingStartedAt: null,
      };
      schedules.push(schedule);
      return [{ id: schedule.id }];
    }

    if (query.includes('FROM notifications') && query.includes('WHERE user_id')) return [];

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
        createdAt: dbNow.toISOString(),
        read: false,
      };
      notifications.push(notification);
      return [notificationRow(notification)];
    }

    if (query.includes('SELECT notifications_enabled AS "notificationsEnabled"')) {
      return [{ notificationsEnabled: true }];
    }

    if (query.includes('FROM push_subscriptions')) return [];

    if (query.includes('UPDATE notification_schedules') && query.includes('sent_at = CASE')) {
      const status = String(values[0]);
      const scheduleId = String(values[6] ?? '');
      const schedule = schedules.find((item) => item.id === scheduleId);
      const canUpdate = schedule && (
        !['sent', 'failed'].includes(status) ||
        (schedule.status === 'processing' && schedule.cancelledAt === null)
      );
      if (!schedule || !canUpdate) return [];

      schedule.status = status;
      schedule.sentAt = status === 'sent' ? dbNow.toISOString() : schedule.sentAt;
      schedule.failedAt = status === 'failed' ? dbNow.toISOString() : schedule.failedAt;
      schedule.cancelledAt = status === 'cancelled' ? dbNow.toISOString() : schedule.cancelledAt;
      schedule.processingStartedAt = null;
      return [scheduleRow(schedule)];
    }

    if (query.includes('FROM pg_stat_activity')) return [{ longRunningActive: 0, waitingOnLock: 0 }];
    if (query.includes('FROM pg_locks')) return [{ waitingLocksOnReminderTables: 0, grantedLocksOnReminderTables: 0 }];

    return [];
  }) as SqlClient;

  return { sql, job, schedules, notifications };
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
  const {
    signCalendarFeedToken,
    signToken,
    verifyCalendarFeedToken,
  } = await import('../lib/jwt.js');
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
  const { handleNotificationProcessDue, handleNotificationsCollection } = await import('../lib/handlers/notifications.js');
  const {
    handleTaskCalendarExport,
    handleTaskCalendarFeed,
    handleTasksCollection,
  } = await import('../lib/handlers/tasks.js');
  const { handleAssistantMessage } = await import('../lib/handlers/assistant.js');
  const { assistantActionSchema } = await import('../lib/assistant/schemas.js');
  const { executeAssistantAction } = await import('../lib/assistant/tools.js');
  const {
    clearNotificationsForUser,
    listNotificationsForUser,
    sendPushPayloadToUser,
  } = await import('../lib/notifications.js');
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

  await run('assistant message without auth returns 401', async () => {
    const response = await handleAssistantMessage({
      sql: createAssistantSqlMock().sql,
      request: {
        method: 'POST',
        headers: {},
        body: { message: 'Me lembre de estudar amanhã' },
      },
    });

    assert.equal(response.status, 401);
  });

  await run('assistant rejects empty message before calling Gemini', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const response = await handleAssistantMessage({
      sql: createAssistantSqlMock().sql,
      request: {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: { message: '   ' },
      },
    });

    assert.equal(response.status, 400);
    assert.match(String((response.body as { error?: string }).error), /Digite uma mensagem/);
  });

  await run('assistant returns friendly error when Gemini key is missing', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const previousKey = process.env.GEMINI_API_KEY;

    try {
      delete process.env.GEMINI_API_KEY;
      const response = await handleAssistantMessage({
        sql: createAssistantSqlMock().sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'Me lembre de estudar amanhã' },
        },
      });

      assert.equal(response.status, 503);
      assert.match(String((response.body as { error?: string }).error), /GEMINI_API_KEY/);
    } finally {
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
    }
  });

  await run('assistant handles invalid Gemini JSON with friendly error', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const previousKey = process.env.GEMINI_API_KEY;
    const previousFetch = globalThis.fetch;

    try {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      globalThis.fetch = (async () => new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'isso nao e json' }] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

      const response = await handleAssistantMessage({
        sql: createAssistantSqlMock().sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'Me lembre de estudar amanhã' },
        },
      });

      assert.equal(response.status, 503);
      assert.match(String((response.body as { error?: string }).error), /interpretar/);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
    }
  });

  await run('assistant Gemini create_task creates valid task', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const previousKey = process.env.GEMINI_API_KEY;
    const previousFetch = globalThis.fetch;
    const { sql, tasks } = createAssistantSqlMock();

    try {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      globalThis.fetch = (async () => new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                type: 'create_task',
                payload: {
                  title: 'Estudar JavaScript',
                  dueDate: '2026-05-28T20:00:00-03:00',
                  priority: 'medium',
                  category: 'Estudos',
                  tags: ['javascript'],
                  alarmEnabled: true,
                },
                confirmationMessage: 'Pronto, criei o lembrete para estudar JavaScript amanhã às 20h.',
              }),
            }],
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

      const response = await handleAssistantMessage({
        sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'Crie um lembrete para eu estudar JavaScript amanhã às 20h.' },
        },
      });

      assert.equal(response.status, 200);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].title, 'Estudar JavaScript');
      assert.equal((response.body as { action?: { type?: string } }).action?.type, 'create_task');
      assert.equal(typeof (response.body as { conversationId?: string }).conversationId, 'string');
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
    }
  });

  await run('assistant accepts Gemini action alias response for create_task', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const store = createAssistantSqlMock();

    await withMockedGeminiResponse({
      action: 'create_task',
      payload: {
        title: 'teste de IA',
        dueDate: '2026-05-27T23:59:00-03:00',
        alarmEnabled: true,
        timezone: 'America/Fortaleza',
      },
    }, async () => {
      const response = await handleAssistantMessage({
        sql: store.sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'crie um lembrete para hoje as 23:59 com o titulo teste de IA' },
        },
      });

      assert.equal(response.status, 200);
      assert.equal(store.tasks.length, 1);
      assert.equal(store.tasks[0].title, 'teste de IA');
      assert.equal((response.body as { action?: { type?: string } }).action?.type, 'create_task');
      assert.match(String((response.body as { message?: string }).message), /teste de IA/);
    });
  });

  await run('assistant local overdue brief works without Gemini and keeps first task context', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const previousKey = process.env.GEMINI_API_KEY;
    const previousFetch = globalThis.fetch;
    const store = createAssistantSqlMock();
    store.tasks.push(
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: 'user-1',
        title: 'Resolver boleto atrasado',
        description: '',
        dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        endDate: null,
        priority: 'high',
        category: 'Financeiro',
        tags: [],
        status: 'pending',
        alarmEnabled: false,
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        userId: 'user-1',
        title: 'Comprar material',
        description: '',
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        endDate: null,
        priority: 'medium',
        category: 'Geral',
        tags: [],
        status: 'pending',
        alarmEnabled: false,
      },
    );

    try {
      delete process.env.GEMINI_API_KEY;
      globalThis.fetch = (async () => {
        throw new Error('Gemini nao deveria ser chamado para brief local.');
      }) as typeof fetch;

      const briefResponse = await handleAssistantMessage({
        sql: store.sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'Ver atrasados' },
        },
      });

      const briefBody = briefResponse.body as {
        conversationId?: string;
        message?: string;
        action?: { type?: string; status?: string };
      };
      assert.equal(briefResponse.status, 200);
      assert.equal(briefBody.action?.type, 'assistant_brief');
      assert.equal(briefBody.action?.status, 'success');
      assert.match(String(briefBody.message), /Resolver boleto atrasado/);
      assert.equal(store.contextRefs.some((ref) => (
        ref.refKey === 'last_listed_tasks' &&
        JSON.stringify(ref.metadata).includes('Resolver boleto atrasado')
      )), true);

      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
      globalThis.fetch = previousFetch;

      await withMockedGeminiResponse({
        type: 'update_task',
        payload: {
          contextRef: 'last_listed_task_first',
          updates: { status: 'completed' },
        },
        confirmationMessage: 'Pronto, conclui o primeiro atrasado.',
      }, async () => {
        const updateResponse = await handleAssistantMessage({
          sql: store.sql,
          request: {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
            body: {
              message: 'Marca o primeiro como concluido',
              conversationId: briefBody.conversationId,
            },
          },
        });

        assert.equal(updateResponse.status, 200);
        assert.equal(store.tasks.find((task) => task.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')?.status, 'completed');
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
    }
  });

  await run('assistant creates conversation, messages, event and last_created_task ref', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const store = createAssistantSqlMock();
    await withMockedGeminiResponse({
      type: 'create_task',
      payload: {
        title: 'Pagar aluguel',
        dueDate: '2026-06-05T09:00:00-03:00',
        category: 'Financeiro',
        tags: ['aluguel'],
        alarmEnabled: true,
      },
      confirmationMessage: 'Pronto, criei o lembrete para pagar o aluguel dia 5 às 9h.',
    }, async () => {
      const response = await handleAssistantMessage({
        sql: store.sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'Me lembre de pagar o aluguel dia 5 às 9h.' },
        },
      });

      const body = response.body as {
        conversationId?: string;
        action?: { type?: string; status?: string; entityId?: string; entityTitle?: string };
      };
      assert.equal(response.status, 200);
      assert.equal(store.conversations.length, 1);
      assert.equal(body.conversationId, store.conversations[0].id);
      assert.equal(store.messages.filter((message) => message.role === 'user').length, 1);
      assert.equal(store.messages.filter((message) => message.role === 'assistant').length, 1);
      assert.equal(store.actionEvents.some((event) => event.actionType === 'create_task' && event.status === 'success'), true);
      assert.equal(store.contextRefs.some((ref) => ref.refKey === 'last_created_task' && ref.entityTitle === 'Pagar aluguel'), true);
      assert.equal(body.action?.entityTitle, 'Pagar aluguel');
    });
  });

  await run('assistant reuses conversation and updates last created task by context', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const store = createAssistantSqlMock();

    let conversationId = '';
    await withMockedGeminiResponse({
      type: 'create_task',
      payload: {
        title: 'Estudar JavaScript',
        dueDate: '2026-05-28T20:00:00-03:00',
        priority: 'medium',
      },
      confirmationMessage: 'Pronto, criei o lembrete.',
    }, async () => {
      const response = await handleAssistantMessage({
        sql: store.sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'Cria um lembrete para estudar JavaScript amanhã às 20h.' },
        },
      });
      conversationId = String((response.body as { conversationId?: string }).conversationId);
    });

    await withMockedGeminiResponse({
      type: 'update_task',
      payload: {
        contextRef: 'last_created_task',
        updates: { priority: 'high' },
      },
      confirmationMessage: 'Pronto, coloquei prioridade alta.',
    }, async () => {
      const response = await handleAssistantMessage({
        sql: store.sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'Coloca prioridade alta.', conversationId },
        },
      });

      assert.equal(response.status, 200);
      assert.equal(store.conversations.length, 1);
      assert.equal(store.messages.length, 4);
      assert.equal(store.tasks[0].priority, 'high');
      assert.equal((response.body as { conversationId?: string }).conversationId, conversationId);
      assert.equal((response.body as { action?: { type?: string } }).action?.type, 'update_task');
      assert.equal(store.contextRefs.some((ref) => ref.refKey === 'last_updated_task'), true);
    });
  });

  await run('assistant blocks conversation from another user', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const otherToken = signToken({ sub: 'user-2', email: 'other@example.com' });
    const store = createAssistantSqlMock();
    let conversationId = '';

    await withMockedGeminiResponse({
      type: 'answer_only',
      payload: { answer: 'Tudo certo.' },
      confirmationMessage: 'Tudo certo.',
    }, async () => {
      const response = await handleAssistantMessage({
        sql: store.sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'Oi' },
        },
      });
      conversationId = String((response.body as { conversationId?: string }).conversationId);
    });

    await withMockedGeminiResponse({
      type: 'answer_only',
      payload: { answer: 'Nao deveria executar.' },
      confirmationMessage: 'Nao deveria executar.',
    }, async () => {
      const response = await handleAssistantMessage({
        sql: store.sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${otherToken}` },
          body: { message: 'Oi', conversationId },
        },
      });
      assert.equal(response.status, 403);
    });
  });

  await run('assistant updates first task from last listed tasks', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const store = createAssistantSqlMock();
    store.tasks.push(
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: 'user-1',
        title: 'Pagar energia',
        description: '',
        dueDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        endDate: null,
        priority: 'medium',
        category: 'Financeiro',
        tags: [],
        status: 'pending',
        alarmEnabled: false,
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        userId: 'user-1',
        title: 'Comprar pão',
        description: '',
        dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        endDate: null,
        priority: 'medium',
        category: 'Geral',
        tags: [],
        status: 'pending',
        alarmEnabled: false,
      },
    );

    let conversationId = '';
    await withMockedGeminiResponse({
      type: 'list_tasks',
      payload: { status: 'pending' },
      confirmationMessage: 'Aqui estao seus lembretes.',
    }, async () => {
      const response = await handleAssistantMessage({
        sql: store.sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'Quais lembretes tenho para hoje?' },
        },
      });
      conversationId = String((response.body as { conversationId?: string }).conversationId);
    });

    await withMockedGeminiResponse({
      type: 'update_task',
      payload: {
        contextRef: 'last_listed_task_first',
        updates: { status: 'completed' },
      },
      confirmationMessage: 'Pronto, marquei o primeiro como concluido.',
    }, async () => {
      const response = await handleAssistantMessage({
        sql: store.sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'Marca o primeiro como concluído.', conversationId },
        },
      });
      assert.equal(response.status, 200);
      assert.equal(store.tasks.find((task) => task.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')?.status, 'completed');
      assert.equal((response.body as { action?: { entityId?: string } }).action?.entityId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    });
  });

  await run('assistant ambiguous update returns needs_confirmation and pending ref', async () => {
    const store = createAssistantSqlMock();
    store.tasks.push(
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'user-1', title: 'Pagar aluguel', description: '', category: 'Financeiro', tags: [], status: 'pending' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: 'user-1', title: 'Pagar energia', description: '', category: 'Financeiro', tags: [], status: 'pending' },
    );
    const conversation = await (await import('../lib/assistant/memory.js')).ensureAssistantConversation(store.sql, 'user-1');
    const action = assistantActionSchema.parse({
      type: 'update_task',
      payload: {
        search: 'Pagar',
        updates: { status: 'completed' },
      },
      confirmationMessage: 'Pronto.',
    });
    const response = await executeAssistantAction({
      sql: store.sql,
      request: { method: 'POST', headers: {} },
    }, action, { userId: 'user-1', conversationId: conversation.id });

    assert.equal(response.action.status, 'needs_confirmation');
    assert.equal(store.contextRefs.some((ref) => ref.refKey === 'pending_confirmation'), true);
    assert.match(response.message, /mais de um lembrete/i);
  });

  await run('assistant does not send messages from another conversation to Gemini', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const store = createAssistantSqlMock();
    const ownConversation = await (await import('../lib/assistant/memory.js')).ensureAssistantConversation(store.sql, 'user-1');
    const otherConversation = await (await import('../lib/assistant/memory.js')).ensureAssistantConversation(store.sql, 'user-2');
    store.messages.push({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      conversationId: otherConversation.id,
      userId: 'user-2',
      role: 'user',
      content: 'segredo de outro usuario',
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    await withMockedGeminiResponse({
      type: 'answer_only',
      payload: { answer: 'Tudo certo.' },
      confirmationMessage: 'Tudo certo.',
    }, async (requests) => {
      const response = await handleAssistantMessage({
        sql: store.sql,
        request: {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: { message: 'Oi', conversationId: ownConversation.id },
        },
      });
      assert.equal(response.status, 200);
      assert.doesNotMatch(JSON.stringify(requests), /segredo de outro usuario/);
    });
  });

  await run('assistant needs_confirmation action returns question', async () => {
    const action = assistantActionSchema.parse({
      type: 'needs_confirmation',
      payload: { question: 'Para qual dia voce quer esse lembrete?' },
      confirmationMessage: 'Preciso confirmar uma informacao.',
    });
    const response = await executeAssistantAction({
      sql: createAssistantSqlMock().sql,
      request: {
        method: 'POST',
        headers: {},
      },
    }, action);

    assert.equal(response.action.type, 'needs_confirmation');
    assert.match(response.message, /qual dia/i);
  });

  await run('assistant frontend files expose floating button and chat wiring', () => {
    const button = readFileSync(new URL('../src/components/assistant/AssistantFloatingButton.tsx', import.meta.url), 'utf8');
    const chat = readFileSync(new URL('../src/components/assistant/AssistantChat.tsx', import.meta.url), 'utf8');
    const api = readFileSync(new URL('../src/lib/assistantApi.ts', import.meta.url), 'utf8');

    assert.match(button, /data-testid="assistant-floating-button"/);
    assert.match(chat, /data-testid="assistant-chat"/);
    assert.match(chat, /webkitSpeechRecognition|SpeechRecognition/);
    assert.match(api, /\/api\/assistant\/message/);
  });

  await run('calendar feed JWT includes expiration and revocation identifiers', () => {
    const token = signCalendarFeedToken({
      sub: 'user-1',
      email: 'pedro@example.com',
      fid: 'feed-1',
      jti: 'token-1',
    });
    const payload = verifyCalendarFeedToken(token);

    assert.equal(payload.scope, 'calendar-feed');
    assert.equal(payload.fid, 'feed-1');
    assert.equal(payload.jti, 'token-1');
    assert.equal(typeof payload.exp, 'number');
    assert.ok((payload.exp ?? 0) > Math.floor(Date.now() / 1000));
  });

  await run('calendar feed rotation revokes active links before issuing a new one', async () => {
    const authToken = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    let insertedValues: unknown[] = [];

    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join(' ');
      const infrastructureRows = getInfrastructureCheckRows(query);
      if (infrastructureRows) return infrastructureRows;

      if (query.includes('FROM token_blacklist')) return [];
      if (query.includes('FROM users')) {
        return [{
          id: 'user-1',
          name: 'Pedro',
          email: 'pedro@example.com',
          avatar: null,
        }];
      }
      if (query.includes('UPDATE calendar_feeds') && query.includes('RETURNING id')) {
        return [{ id: 'old-feed' }];
      }
      if (query.includes('INSERT INTO calendar_feeds')) {
        insertedValues = values;
        return [];
      }

      return [];
    }) as SqlClient;

    const result = await handleTaskCalendarFeed({
      sql,
      request: {
        method: 'POST',
        headers: { authorization: `Bearer ${authToken}` },
      },
    });

    assert.equal(result.status, 200);
    const body = result.body as { feedPath: string; expiresAt: string; revokedCount: number };
    assert.equal(body.revokedCount, 1);
    assert.ok(Date.parse(body.expiresAt) > Date.now());

    const feedToken = new URL(`https://lembreto.test${body.feedPath}`).searchParams.get('token');
    assert.ok(feedToken);
    const payload = verifyCalendarFeedToken(feedToken);
    assert.equal(payload.fid, insertedValues[0]);
    assert.equal(payload.sub, 'user-1');
    assert.equal(payload.jti, insertedValues[2]);
  });

  await run('calendar feed export rejects revoked feed tokens', async () => {
    const feedToken = signCalendarFeedToken({
      sub: 'user-1',
      email: 'pedro@example.com',
      fid: 'feed-1',
      jti: 'token-1',
    });

    const sql = (async (strings: TemplateStringsArray) => {
      const query = strings.join(' ');
      const infrastructureRows = getInfrastructureCheckRows(query);
      if (infrastructureRows) return infrastructureRows;

      if (query.includes('FROM calendar_feeds')) return [];
      return [];
    }) as SqlClient;

    const result = await handleTaskCalendarExport({
      sql,
      request: {
        method: 'GET',
        headers: {},
        query: { token: feedToken },
      },
    });

    assert.equal(result.status, 401);
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
      clientMutationId: '44444444-4444-4444-8444-444444444444',
      title: 'Estudar',
      description: 'Revisar schemas',
      dueDate: new Date().toISOString(),
      priority: 'high',
      category: 'Estudos',
      suppressHolidayNotifications: true,
    });

    assert.equal(created.priority, 'high');
    assert.equal(created.suppressHolidayNotifications, true);
    assert.equal(created.clientMutationId, '44444444-4444-4444-8444-444444444444');

    const floatingCreated = createTaskSchema.parse({
      title: 'Sem horario fixo',
      description: '',
      dueDate: null,
      endDate: null,
      preNoticeMinutes: null,
      noTimeReminderMinutes: 150,
    });

    assert.equal(floatingCreated.dueDate, null);
    assert.equal(floatingCreated.preNoticeMinutes, null);
    assert.equal(floatingCreated.noTimeReminderMinutes, 150);

    const updated = updateTaskSchema.parse({
      status: 'completed',
      suppressHolidayNotifications: false,
      preNoticeMinutes: null,
    });

    assert.equal(updated.status, 'completed');
    assert.equal(updated.suppressHolidayNotifications, false);
    assert.equal(updated.preNoticeMinutes, null);

    const result = updateTaskSchema.safeParse({});
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatZodError(result.error), 'Envie ao menos um campo para atualizar');
    }
  });

  await run('tasks collection returns paginated task list metadata', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    const selectedValues: unknown[][] = [];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join(' ');
      const infrastructureRows = getInfrastructureCheckRows(query);
      if (infrastructureRows) return infrastructureRows;

      if (query.includes('FROM token_blacklist')) return [];
      if (query.includes('FROM users')) {
        return [{
          id: 'user-1',
          name: 'Pedro',
          email: 'pedro@example.com',
          avatar: null,
        }];
      }

      if (query.includes('CREATE INDEX') || query.includes('ALTER TABLE')) return [];
      if (query.includes('SELECT COUNT(*) AS total')) return [{ total: '2' }];
      if (query.includes('FROM tasks') && query.includes('LIMIT')) {
        selectedValues.push(values);
        return [{
          id: 'task-1',
          userId: 'user-1',
          title: 'Enviar proposta',
          description: '',
          dueDate: '2026-05-21T12:00:00.000Z',
          endDate: null,
          priority: 'high',
          category: 'Trabalho',
          tags: ['cliente'],
          suppressHolidayNotifications: false,
          alarmEnabled: false,
          reminderMode: 'timed',
          expiresAt: null,
          overdueSince: null,
          overdueExpiresAt: null,
          deletedAt: null,
          completedAt: null,
          completionSource: null,
          autoDeletedReason: null,
          autoDeletedAt: null,
          mutedUntil: null,
          status: 'pending',
          history: [],
          createdAt: '2026-05-20T12:00:00.000Z',
          externalCalendarProvider: null,
          externalCalendarEventId: null,
          externalCalendarSyncStatus: 'idle',
          externalCalendarLastError: null,
          externalCalendarSyncedAt: null,
        }];
      }

      return [];
    }) as SqlClient;

    const result = await handleTasksCollection({
      sql,
      request: {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: {
          page: '2',
          limit: '1',
          status: 'pending',
          search: 'proposta',
          sort: 'dueDate',
        },
      },
    });

    assert.equal(result.status, 200);
    assert.equal((result.body as { items: unknown[] }).items.length, 1);
    assert.equal((result.body as { page: number }).page, 2);
    assert.equal((result.body as { limit: number }).limit, 1);
    assert.equal((result.body as { total: number }).total, 2);
    assert.equal((result.body as { totalPages: number }).totalPages, 2);
    assert.equal((result.body as { hasPreviousPage: boolean }).hasPreviousPage, true);
    assert.equal((result.body as { hasNextPage: boolean }).hasNextPage, false);
    assert.equal((result.body as { sort: string }).sort, 'dueDate');
    assert.equal(selectedValues.length, 1);
    assert.equal(selectedValues[0].includes(1), true);
  });

  await run('notifications list returns cursor pagination metadata', async () => {
    const rows = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
        title: 'Alarme',
        message: 'Primeira',
        createdAt: '2026-05-14T17:42:00.000Z',
        read: false,
        tone: 'warning',
        targetType: null,
        targetTaskId: null,
        dedupeKey: null,
        sourceScheduleId: null,
        kind: 'alarm',
      },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        title: 'Aviso',
        message: 'Segunda',
        createdAt: '2026-05-14T17:41:00.000Z',
        read: false,
        tone: 'warning',
        targetType: null,
        targetTaskId: null,
        dedupeKey: null,
        sourceScheduleId: null,
        kind: 'notification',
      },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        title: 'Antiga',
        message: 'Terceira',
        createdAt: '2026-05-14T17:40:00.000Z',
        read: true,
        tone: 'info',
        targetType: null,
        targetTaskId: null,
        dedupeKey: null,
        sourceScheduleId: null,
        kind: 'pre_notice',
      },
    ];
    const calls: unknown[][] = [];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join(' ');
      const infrastructureRows = getInfrastructureCheckRows(query);
      if (infrastructureRows) return infrastructureRows;
      if (query.includes('FROM notifications') && query.includes('ORDER BY created_at DESC')) {
        calls.push(values);
        return rows;
      }
      return [];
    }) as SqlClient;

    const result = await listNotificationsForUser(sql, 'user-1', {
      search: 'aviso',
      read: false,
      tone: 'warning',
      kind: 'notification',
      createdFrom: '2026-05-14T00:00:00.000Z',
      createdTo: '2026-05-14T23:59:59.999Z',
      limit: 2,
    });

    assert.equal(result.notifications.length, 2);
    assert.equal(result.pageInfo.hasMore, true);
    assert.equal(result.pageInfo.limit, 2);
    assert.equal(typeof result.pageInfo.nextCursor, 'string');
    assert.deepEqual(calls[0]?.slice(0, 7), [
      'user-1',
      'aviso',
      'aviso',
      'aviso',
      false,
      false,
      'warning',
    ]);
  });

  await run('notifications delete applies server-side filters', async () => {
    let deleteValues: unknown[] | null = null;
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join(' ');
      const infrastructureRows = getInfrastructureCheckRows(query);
      if (infrastructureRows) return infrastructureRows;
      if (query.includes('DELETE FROM notifications')) {
        deleteValues = values;
        return [{ id: 'notification-1' }, { id: 'notification-2' }];
      }
      return [];
    }) as SqlClient;

    const deleted = await clearNotificationsForUser(sql, 'user-1', {
      search: 'alarme',
      read: true,
      tone: 'error',
      kind: 'alarm',
      createdFrom: '2026-05-01T00:00:00.000Z',
      createdTo: '2026-05-31T23:59:59.999Z',
    });

    assert.equal(deleted, 2);
    assert.ok(deleteValues);
    assert.deepEqual((deleteValues as unknown[]).slice(0, 7), [
      'user-1',
      'alarme',
      'alarme',
      'alarme',
      true,
      true,
      'error',
    ]);
  });

  await run('notifications delete route accepts JSON filter body', async () => {
    const token = signToken({ sub: 'user-1', email: 'pedro@example.com' });
    let deleteValues: unknown[] | null = null;
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join(' ');
      const infrastructureRows = getInfrastructureCheckRows(query);
      if (infrastructureRows) return infrastructureRows;
      if (query.includes('FROM token_blacklist')) return [];
      if (query.includes('FROM users')) {
        return [{
          id: 'user-1',
          name: 'Pedro',
          email: 'pedro@example.com',
          avatar: null,
        }];
      }
      if (query.includes('DELETE FROM notifications')) {
        deleteValues = values;
        return [{ id: 'notification-1' }];
      }
      return [];
    }) as SqlClient;

    const response = await handleNotificationsCollection({
      sql,
      request: {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
        query: {},
        body: {
          search: 'falha',
          read: false,
          tone: 'error',
          createdFrom: '2026-05-20',
          createdTo: '2026-05-21',
        },
      },
    });

    assert.equal(response.status, 200);
    assert.ok(deleteValues);
    assert.deepEqual((deleteValues as unknown[]).slice(0, 7), [
      'user-1',
      'falha',
      'falha',
      'falha',
      false,
      false,
      'error',
    ]);
    assert.equal(deleteValues[10], '2026-05-20T00:00:00.000Z');
    assert.equal(deleteValues[12], '2026-05-21T23:59:59.999Z');
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

  await run('shared overdue reminder progression matches backend thresholds', () => {
    assert.deepEqual(
      buildOverdueScheduleOffsets().slice(0, 8).map((item) => item.intervalMinutes),
      [15, 30, 45, 75, 120, 195, 315, 360],
    );
    assert.deepEqual(
      buildOverdueScheduleOffsets().slice(0, 5).map((item) => item.thresholdMinutes),
      [15, 45, 90, 165, 285],
    );
    assert.deepEqual(
      buildOverdueScheduleOffsets(undefined, 'gentle').slice(0, 3).map((item) => item.intervalMinutes),
      [30, 120, 360],
    );
    assert.deepEqual(
      buildOverdueScheduleOffsets(undefined, 'insistent').slice(0, 5).map((item) => item.intervalMinutes),
      [5, 15, 30, 60, 120],
    );
    assert.deepEqual(buildOverdueScheduleOffsets(undefined, 'silent'), []);
    assert.equal(getOverdueReminderSequence(14), null);
    assert.equal(getOverdueReminderSequence(15)?.sequenceIndex, 0);
    assert.equal(getOverdueReminderSequence(44)?.sequenceIndex, 0);
    assert.equal(getOverdueReminderSequence(45)?.sequenceIndex, 1);
    assert.equal(getOverdueReminderSequence(90)?.sequenceIndex, 2);
    assert.equal(getOverdueReminderSequence(4, 'insistent'), null);
    assert.equal(getOverdueReminderSequence(5, 'insistent')?.sequenceIndex, 0);
    assert.equal(getOverdueReminderSequence(29, 'gentle'), null);
    assert.equal(getOverdueReminderSequence(30, 'gentle')?.sequenceIndex, 0);
    assert.equal(getOverdueReminderSequence(500, 'silent'), null);

    const cappedSequence = getOverdueReminderSequence(5 * 24 * 60, 'normal');
    const uncappedSequence = getOverdueReminderSequence(5 * 24 * 60, 'normal', Number.POSITIVE_INFINITY);
    assert.ok(cappedSequence);
    assert.ok(uncappedSequence);
    assert.ok(uncappedSequence.sequenceIndex > cappedSequence.sequenceIndex);
  });

  await run('offline due notification is exact even when alarm is enabled', () => {
    const appSource = readFileSync('src/App.tsx', 'utf8');

    assert.ok(appSource.includes('millisecondsSinceDue < 0 || millisecondsSinceDue >= 60_000'));
    assert.ok(appSource.includes('const timedActiveTasks = useMemo'));
    assert.equal(appSource.includes('if (!task.alarmEnabled && minutesUntil === 0)'), false);
  });

  await run('alarm lifecycle and push actions are actionable', () => {
    const appSource = readFileSync('src/App.tsx', 'utf8');
    const scheduleSource = readFileSync('lib/notification-schedules.ts', 'utf8');
    const serviceWorkerSource = readFileSync('public/push-sw.js', 'utf8');

    assert.ok(appSource.includes('if (!activeAlarm) return;'));
    assert.ok(appSource.includes('alarmAutoCloseTimerRef.current = window.setTimeout'));
    assert.ok(appSource.includes("notificationAction === 'alarmSnooze'"));
    assert.ok(scheduleSource.includes("action: 'alarm_snooze_10'"));
    assert.ok(serviceWorkerSource.includes("action === 'alarm_snooze_10'"));
  });

  await run('silent overdue reminders do not re-enter overdue cron backlog', () => {
    const scheduleSource = readFileSync('lib/notification-schedules.ts', 'utf8');
    const notificationHandlerSource = readFileSync('lib/handlers/notifications.ts', 'utf8');

    assert.ok(scheduleSource.includes("COALESCE(tasks.overdue_reminder_intensity, 'normal') <> 'silent'"));
    assert.ok(notificationHandlerSource.includes("COALESCE(overdue_reminder_intensity, 'normal') <> 'silent'"));
  });

  await run('overdue expiration adapts by reminder context', () => {
    const dueDate = new Date('2026-05-15T12:00:00.000Z');
    const endDate = new Date('2026-05-15T13:00:00.000Z');

    assert.equal(
      buildOverdueExpiresAt(dueDate, {
        endDate,
        priority: 'medium',
        category: 'Geral',
      })?.toISOString(),
      '2026-05-16T12:00:00.000Z',
    );
    assert.equal(
      buildOverdueExpiresAt(dueDate, {
        endDate,
        priority: 'high',
        category: 'Geral',
      })?.toISOString(),
      '2026-05-18T12:00:00.000Z',
    );
    assert.equal(
      buildOverdueExpiresAt(dueDate, {
        endDate,
        priority: 'medium',
        category: 'Trabalho',
      })?.toISOString(),
      '2026-05-18T12:00:00.000Z',
    );
    assert.equal(
      buildOverdueExpiresAt(dueDate, {
        endDate: null,
        priority: 'medium',
        category: 'Geral',
      }),
      null,
    );
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

  await run('does not create central notification when user disabled notifications', async () => {
    const { sql, schedule, notifications } = createNotificationScheduleSqlMock({ notificationsEnabled: false });
    const result = await processDueNotificationSchedules(sql, 20);

    assert.equal(result.fetchedSchedules, 1);
    assert.equal(result.processedSchedules, 1);
    assert.equal(result.sentSchedules, 0);
    assert.equal(result.cancelledSchedules, 1);
    assert.equal(notifications.length, 0);
    assert.equal(schedule.status, 'cancelled');
    assert.equal(schedule.errorMessage, 'notifications_disabled');
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

  await run('records push delivery status per subscription', async () => {
    const previousPublicKey = process.env.VAPID_PUBLIC_KEY;
    const previousPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const keys = webpush.generateVAPIDKeys();
    const mutableWebPush = webpush as unknown as {
      sendNotification: (
        subscription: { endpoint: string },
        payload?: string,
        options?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    const originalSendNotification = mutableWebPush.sendNotification;

    try {
      process.env.VAPID_PUBLIC_KEY = keys.publicKey;
      process.env.VAPID_PRIVATE_KEY = keys.privateKey;
      mutableWebPush.sendNotification = async (subscription) => {
        if (subscription.endpoint.endsWith('/fail')) {
          throw Object.assign(new Error('simulated push failure'), { statusCode: 503 });
        }
        return {};
      };

      const { sql, userId, notificationId, deliveries } = createPushDeliverySqlMock();
      await sendPushPayloadToUser(sql, userId, { title: 'Teste' }, notificationId);

      assert.equal(deliveries.length, 2);
      assert.ok(deliveries.some((delivery) => (
        delivery.endpoint === 'https://push.example.test/success' &&
        delivery.status === 'delivered'
      )));
      assert.ok(deliveries.some((delivery) => (
        delivery.endpoint === 'https://push.example.test/fail' &&
        delivery.status === 'failed' &&
        String(delivery.lastError).includes('simulated push failure')
      )));
    } finally {
      mutableWebPush.sendNotification = originalSendNotification;
      if (previousPublicKey === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = previousPublicKey;
      if (previousPrivateKey === undefined) delete process.env.VAPID_PRIVATE_KEY;
      else process.env.VAPID_PRIVATE_KEY = previousPrivateKey;
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

  await run('side effect sync skips schedules when user disabled notifications', async () => {
    const { sql, jobs, schedules } = createTaskSideEffectsSqlMock({
      dueMinutesFromNow: 5,
      notificationsEnabled: false,
    });
    const result = await processTaskSideEffects(sql, 3, 8000);

    assert.equal(result.fetched, 1);
    assert.equal(result.done, 1);
    assert.equal(jobs.find((job) => job.kind === 'sync_notification_schedules')?.status, 'done');
    assert.equal(schedules.length, 0);
  });

  await run('side effect sync keeps exact notification when alarm is enabled', async () => {
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
    assert.ok(schedules.some((schedule) => (
      schedule.taskId === task.id &&
      schedule.kind === 'notification' &&
      schedule.notifyAt === task.dueDate
    )));
  });

  await run('side effect sync creates pre notice when there is enough time', async () => {
    const { sql, schedules, task } = createTaskSideEffectsSqlMock({ dueMinutesFromNow: 30 });
    const result = await processTaskSideEffects(sql, 3, 8000);

    assert.equal(result.fetched, 1);
    assert.equal(result.done, 1);
    assert.ok(schedules.some((schedule) => schedule.taskId === task.id && schedule.kind === 'pre_notice'));
    assert.ok(schedules.some((schedule) => schedule.taskId === task.id && schedule.kind === 'notification'));
  });

  await run('side effect sync respects custom pre notice minutes', async () => {
    const { sql, schedules, task } = createTaskSideEffectsSqlMock({
      dueMinutesFromNow: 30,
      preNoticeMinutes: 5,
    });
    const result = await processTaskSideEffects(sql, 3, 8000);

    assert.equal(result.fetched, 1);
    assert.equal(result.done, 1);
    const preNotice = schedules.find((schedule) => schedule.taskId === task.id && schedule.kind === 'pre_notice');
    assert.ok(preNotice);
    const dueTime = new Date(String(task.dueDate)).getTime();
    const preNoticeTime = new Date(String(preNotice?.notifyAt)).getTime();
    assert.equal(dueTime - preNoticeTime, 5 * 60_000);
  });

  await run('side effect sync creates immediate pre notice when due date is too close', async () => {
    const { sql, schedules, task } = createTaskSideEffectsSqlMock({ dueMinutesFromNow: 5 });
    const result = await processTaskSideEffects(sql, 3, 8000);

    assert.equal(result.fetched, 1);
    assert.equal(result.done, 1);
    assert.ok(schedules.some((schedule) => (
      schedule.taskId === task.id &&
      schedule.kind === 'pre_notice' &&
      new Date(String(schedule.notifyAt)).getTime() < new Date(String(task.dueDate)).getTime()
    )));
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

  await run('cron post-side-effect pass sends schedule created in same run', async () => {
    const previousSecret = process.env.CRON_SECRET;
    const previousMaintenance = process.env.CRON_ENABLE_MAINTENANCE_STAGES;
    const { handleNotificationsCron } = await import('../lib/handlers/notifications.js');
    const { sql, job, schedules, notifications } = createCronPostSideEffectScheduleSqlMock();

    try {
      process.env.CRON_SECRET = 'test-cron-secret';
      delete process.env.CRON_ENABLE_MAINTENANCE_STAGES;
      const response = await handleNotificationsCron({
        sql,
        request: {
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        },
      });

      const body = response.body as {
        schedules?: { fetched?: number; processed?: number; sent?: number };
        sideEffects?: { done?: number };
      };
      assert.equal(response.status, 200);
      assert.equal(body.sideEffects?.done, 1);
      assert.equal(body.schedules?.fetched, 2);
      assert.equal(body.schedules?.processed, 2);
      assert.equal(body.schedules?.sent, 2);
      assert.equal(job.status, 'done');
      assert.equal(schedules.length, 2);
      assert.ok(schedules.some((schedule) => schedule.kind === 'pre_notice' && schedule.status === 'sent'));
      assert.ok(schedules.some((schedule) => schedule.kind === 'notification' && schedule.status === 'sent'));
      assert.equal(notifications.length, 2);
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
      if (previousMaintenance === undefined) delete process.env.CRON_ENABLE_MAINTENANCE_STAGES;
      else process.env.CRON_ENABLE_MAINTENANCE_STAGES = previousMaintenance;
    }
  });

  await run('cron processes due schedules before and after side effects', () => {
    const cronHandler = readFileSync(new URL('../lib/handlers/notifications.ts', import.meta.url), 'utf8');
    const dueIndex = cronHandler.indexOf('processDueNotificationSchedules(');
    const sideEffectIndex = cronHandler.indexOf('processTaskSideEffects(sql');
    const postSideEffectDueIndex = cronHandler.indexOf('processDueNotificationSchedulesAfterSideEffects');

    assert.ok(dueIndex >= 0);
    assert.ok(sideEffectIndex >= 0);
    assert.ok(postSideEffectDueIndex >= 0);
    assert.ok(dueIndex < sideEffectIndex);
    assert.ok(sideEffectIndex < postSideEffectDueIndex);
  });

  await run('cron handler has global deadline and nested schedule response', () => {
    const cronHandler = readFileSync(new URL('../lib/handlers/notifications.ts', import.meta.url), 'utf8');

    assert.ok(cronHandler.includes('const MAX_CRON_RESPONSE_MS = 20000;'));
    assert.ok(cronHandler.includes('function withTimeout'));
    assert.ok(cronHandler.includes("stage: 'processDueNotificationSchedules'") || cronHandler.includes("'processDueNotificationSchedules'"));
    assert.ok(cronHandler.includes("'processTaskSideEffects'"));
    assert.ok(cronHandler.includes("'processDueNotificationSchedulesAfterSideEffects'"));
    assert.ok(cronHandler.includes('addScheduleSummaries(result, postSideEffectSchedules)'));
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
    assert.ok(cronHandler.includes('task_side_effects_due_by_kind'));
    assert.ok(cronHandler.includes('cron_notifications_backlog_warning'));
    assert.ok(cronHandler.includes('backlogWarnings'));
    assert.ok(cronHandler.includes('backfillDiagnostics'));
  });

  await run('reminder scheduler workflow has safe logs and authenticated cron call', () => {
    const workflow = readFileSync(new URL('../.github/workflows/reminder-scheduler.yml', import.meta.url), 'utf8');

    assert.match(workflow, /cron: "\* \* \* \* \*"/);
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
    assert.match(workflow, /hasMore=true/);
    assert.match(workflow, /backlogWarnings/);
    assert.doesNotMatch(workflow, /echo .*CRON_SECRET/);
    assert.doesNotMatch(workflow, /set -x/);
  });

  await run('task creation enqueues notification schedule side effect before calendar sync', () => {
    const taskHandler = readFileSync(new URL('../lib/handlers/tasks.ts', import.meta.url), 'utf8');
    const createStart = taskHandler.indexOf("if (request.method === 'POST')");
    const createEnd = taskHandler.indexOf('return methodNotAllowed();', createStart);
    const createTaskHandler = taskHandler.slice(createStart, createEnd);
    const scheduleIndex = createTaskHandler.indexOf("'sync_notification_schedules'");
    const calendarIndex = createTaskHandler.indexOf("'sync_external_calendar'");

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
        backfill?: {
          skippedReason?: string;
          backfillDiagnostics?: { skippedReasons?: Record<string, number> };
        };
        calendarSync?: { skippedReason?: string };
      };
      assert.equal(body.scheduleDiagnostics?.duePendingCount, 1);
      assert.equal(body.sideEffectDiagnostics?.duePendingCount, 1);
      assert.equal(body.backfill?.backfillDiagnostics?.skippedReasons?.no_schedule_created, 1);
      assert.equal(body.calendarSync?.skippedReason, 'no_external_calendar_side_effects_due');
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
      if (previousMaintenance === undefined) delete process.env.CRON_ENABLE_MAINTENANCE_STAGES;
      else process.env.CRON_ENABLE_MAINTENANCE_STAGES = previousMaintenance;
    }
  });

  await run('cron reclaims a small batch of stuck processing schedules', async () => {
    const previousSecret = process.env.CRON_SECRET;
    const previousMaintenance = process.env.CRON_ENABLE_MAINTENANCE_STAGES;
    const { handleNotificationsCron } = await import('../lib/handlers/notifications.js');

    try {
      process.env.CRON_SECRET = 'test-cron-secret';
      delete process.env.CRON_ENABLE_MAINTENANCE_STAGES;
      const response = await handleNotificationsCron({
        sql: createCronHealthSqlMock({
          schedulesProcessing: 3,
          schedulesStuckProcessing: 3,
        }),
        request: {
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        },
      });

      assert.equal(response.status, 200);
      const body = response.body as {
        schedules?: { reclaimed?: number; fetched?: number };
        scheduleDiagnostics?: { processingCount?: number };
      };
      assert.equal(body.schedules?.reclaimed, 2);
      assert.equal(body.schedules?.fetched, 0);
      assert.equal(body.scheduleDiagnostics?.processingCount, 3);
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
