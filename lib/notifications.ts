import { format } from 'date-fns';
import webpush from 'web-push';
import {
  type NotificationScheduleKind,
  type NotificationTargetType,
  type NotificationTone,
} from './contracts.js';
import { isHolidayForLocationOnDate } from './holidays.js';
import type { SqlClient } from './handlers/core.js';
import { logError, logInfo, logWarn } from './logger.js';

export interface NotificationTarget {
  type: 'task';
  taskId: string;
}

export interface AppNotificationRecord {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  tone: NotificationTone;
  target?: NotificationTarget | { type: Exclude<NotificationTargetType, 'task'> };
  dedupeKey?: string;
  sourceScheduleId?: string;
  kind?: NotificationScheduleKind;
}

interface NotificationRow {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  tone: NotificationTone;
  targetType: NotificationTargetType | null;
  targetTaskId: string | null;
  dedupeKey: string | null;
  sourceScheduleId?: string | null;
  kind?: NotificationScheduleKind | null;
}

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

export interface PushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string | null;
}

export interface CreateNotificationInput {
  userId: string;
  title: string;
  message: string;
  tone: NotificationTone;
  target?: AppNotificationRecord['target'];
  dedupeKey?: string;
  sourceScheduleId?: string | null;
  kind?: NotificationScheduleKind;
  sendPush?: boolean;
}

export interface CreateNotificationResult {
  created: boolean;
  notification: AppNotificationRecord;
}

export interface ScheduledNotificationSummary {
  scannedTasks: number;
  createdNotifications: number;
}

export class NotificationReferenceUnavailableError extends Error {
  constructor(message = 'Notification reference unavailable') {
    super(message);
    this.name = 'NotificationReferenceUnavailableError';
  }
}

export const UPCOMING_REMINDER_MINUTES = 15;
export const OVERDUE_REMINDER_INTERVAL_MINUTES = 30;
let ensureNotificationsInfrastructurePromise: Promise<void> | null = null;

function isForeignKeyReferenceError(error: unknown) {
  if (!error || typeof error !== 'object') return false;

  const maybeError = error as { code?: unknown; message?: unknown };
  const message = typeof maybeError.message === 'string' ? maybeError.message : '';

  return maybeError.code === '23503'
    || message.includes('notifications_user_id_fkey')
    || message.includes('notifications_target_task_id_fkey');
}

function buildTarget(row: NotificationRow): AppNotificationRecord['target'] | undefined {
  if (!row.targetType) return undefined;

  if (row.targetType === 'task' && row.targetTaskId) {
    return { type: 'task', taskId: row.targetTaskId };
  }

  if (row.targetType === 'notifications' || row.targetType === 'profile' || row.targetType === 'settings') {
    return { type: row.targetType };
  }

  return undefined;
}

export function mapNotificationRow(row: NotificationRow): AppNotificationRecord {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    createdAt: row.createdAt,
    read: row.read,
    tone: row.tone,
    target: buildTarget(row),
    dedupeKey: row.dedupeKey ?? undefined,
    sourceScheduleId: row.sourceScheduleId ?? undefined,
    kind: row.kind ?? undefined,
  };
}

export function getPushPublicKey() {
  const value = process.env.VAPID_PUBLIC_KEY?.trim();
  return value && value.length > 0 ? value : null;
}

function getPushPrivateKey() {
  const value = process.env.VAPID_PRIVATE_KEY?.trim();
  return value && value.length > 0 ? value : null;
}

function getPushSubject() {
  const configured = process.env.VAPID_SUBJECT?.trim();
  return configured && configured.length > 0
    ? configured
    : 'mailto:notificacoes@lembreto.app';
}

export function isPushConfigured() {
  return Boolean(getPushPublicKey() && getPushPrivateKey());
}

function getWebPushClient() {
  const publicKey = getPushPublicKey();
  const privateKey = getPushPrivateKey();
  if (!publicKey || !privateKey) return null;

  webpush.setVapidDetails(getPushSubject(), publicKey, privateKey);
  return webpush;
}

function buildNotificationNavigationPath(target?: AppNotificationRecord['target']) {
  const params = new URLSearchParams();

  if (target?.type === 'task') {
    params.set('notificationTarget', 'task');
    params.set('taskId', target.taskId);
  } else if (target?.type === 'profile') {
    params.set('notificationTarget', 'profile');
  } else if (target?.type === 'settings') {
    params.set('notificationTarget', 'settings');
  } else {
    params.set('notificationTarget', 'notifications');
  }

  const query = params.toString();
  return query.length > 0 ? `/?${query}` : '/';
}

function buildPushPayload(notification: AppNotificationRecord) {
  return {
    title: notification.title,
    body: notification.message,
    tag: notification.dedupeKey ?? `notification:${notification.id}`,
    icon: '/icon.png',
    badge: '/icon.png',
    data: {
      id: notification.id,
      notificationId: notification.id,
      path: buildNotificationNavigationPath(notification.target),
      target: notification.target ?? { type: 'notifications' },
      taskId: notification.target?.type === 'task' ? notification.target.taskId : undefined,
      tone: notification.tone,
      createdAt: notification.createdAt,
      dedupeKey: notification.dedupeKey,
      sourceScheduleId: notification.sourceScheduleId,
      scheduleId: notification.sourceScheduleId,
      kind: notification.kind,
    },
  };
}

async function shouldSendPushToUser(sql: SqlClient, userId: string) {
  const rows = await sql`
    SELECT notifications_enabled AS "notificationsEnabled"
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;

  return rows[0]?.notificationsEnabled !== false;
}

async function sendPushNotificationToUser(
  sql: SqlClient,
  userId: string,
  notification: AppNotificationRecord,
) {
  await sendPushPayloadToUser(sql, userId, buildPushPayload(notification), notification.id);
}

export async function sendPushPayloadToUser(
  sql: SqlClient,
  userId: string,
  payload: unknown,
  notificationId?: string,
) {
  const client = getWebPushClient();
  if (!client) return;

  if (!(await shouldSendPushToUser(sql, userId))) return;

  const rows = await sql`
    SELECT
      endpoint,
      p256dh,
      auth,
      user_agent AS "userAgent"
    FROM push_subscriptions
    WHERE user_id = ${userId}
  `;

  const subscriptions = rows as unknown as PushSubscriptionRow[];
  if (subscriptions.length === 0) return;

  const serializedPayload = JSON.stringify(payload);

  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await client.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          serializedPayload,
        );
      } catch (error) {
        const statusCode =
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          typeof (error as { statusCode?: unknown }).statusCode === 'number'
            ? (error as { statusCode: number }).statusCode
            : null;

        if (statusCode === 404 || statusCode === 410) {
          await sql`
            DELETE FROM push_subscriptions
            WHERE endpoint = ${subscription.endpoint}
          `;
          logWarn('push_subscription_removed_stale', {
            userId,
            endpoint: subscription.endpoint,
            statusCode,
          });
          return;
        }

        logError('push_notification_send_failed', error, {
          userId,
          endpoint: subscription.endpoint,
          notificationId,
        });
      }
    }),
  );
}

async function hasNotificationsInfrastructure(sql: SqlClient): Promise<boolean> {
  const rows = await sql`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'notifications_enabled'
      ) AS "hasUserSetting",
      to_regclass('public.notifications') IS NOT NULL AS "hasNotifications",
      to_regclass('public.push_subscriptions') IS NOT NULL AS "hasPushSubscriptions",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notifications'
          AND column_name = 'kind'
      ) AS "hasNotificationKind",
      to_regclass('public.idx_notifications_user_created') IS NOT NULL AS "hasCreatedIndex",
      to_regclass('public.idx_notifications_user_read') IS NOT NULL AS "hasReadIndex",
      to_regclass('public.idx_notifications_user_dedupe') IS NOT NULL AS "hasDedupeIndex",
      to_regclass('public.idx_notifications_source_schedule') IS NOT NULL AS "hasSourceScheduleIndex",
      to_regclass('public.idx_push_subscriptions_user_seen') IS NOT NULL AS "hasPushIndex"
  `;

  const row = rows[0] as
    | {
        hasUserSetting?: boolean;
        hasNotifications?: boolean;
        hasPushSubscriptions?: boolean;
        hasNotificationKind?: boolean;
        hasCreatedIndex?: boolean;
        hasReadIndex?: boolean;
        hasDedupeIndex?: boolean;
        hasSourceScheduleIndex?: boolean;
        hasPushIndex?: boolean;
      }
    | undefined;

  return Boolean(
      row?.hasUserSetting &&
      row.hasNotifications &&
      row.hasPushSubscriptions &&
      row.hasNotificationKind &&
      row.hasCreatedIndex &&
      row.hasReadIndex &&
      row.hasDedupeIndex &&
      row.hasSourceScheduleIndex &&
      row.hasPushIndex,
  );
}

export async function ensureNotificationsInfrastructure(sql: SqlClient) {
  if (!ensureNotificationsInfrastructurePromise) {
    ensureNotificationsInfrastructurePromise = (async () => {
      if (await hasNotificationsInfrastructure(sql)) return;

      await sql`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS notifications (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          tone TEXT NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'success', 'warning', 'error')),
          read BOOLEAN NOT NULL DEFAULT FALSE,
          target_type TEXT CHECK (target_type IN ('task', 'notifications', 'profile', 'settings')),
          target_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
          dedupe_key TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        ALTER TABLE notifications
        DROP CONSTRAINT IF EXISTS notifications_dedupe_key_key
      `;

      await sql`
        ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS source_schedule_id UUID
      `;

      await sql`
        ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS kind TEXT CHECK (
          kind IN ('pre_notice', 'notification', 'alarm', 'floating_reminder', 'overdue_reminder')
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_notifications_user_created
        ON notifications(user_id, created_at DESC)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_notifications_user_read
        ON notifications(user_id, read, created_at DESC)
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
        ON notifications(user_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_source_schedule
        ON notifications(source_schedule_id)
        WHERE source_schedule_id IS NOT NULL
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          expiration_time BIGINT,
          user_agent TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_seen
        ON push_subscriptions(user_id, last_seen_at DESC)
      `;
    })();
  }

  await ensureNotificationsInfrastructurePromise;
}

export async function listNotificationsForUser(sql: SqlClient, userId: string) {
  await ensureNotificationsInfrastructure(sql);

  const rows = await sql`
    SELECT
      id,
      title,
      message,
      created_at AS "createdAt",
      read,
      tone,
      target_type AS "targetType",
      target_task_id AS "targetTaskId",
      dedupe_key AS "dedupeKey",
      source_schedule_id AS "sourceScheduleId",
      kind
    FROM notifications
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 200
  `;

  return rows.map((row) => mapNotificationRow(row as unknown as NotificationRow));
}

export async function getNotificationsEnabled(sql: SqlClient, userId: string) {
  await ensureNotificationsInfrastructure(sql);

  const rows = await sql`
    SELECT notifications_enabled AS "notificationsEnabled"
    FROM users
    WHERE id = ${userId}
  `;

  return rows[0]?.notificationsEnabled !== false;
}

export async function setNotificationsEnabled(sql: SqlClient, userId: string, enabled: boolean) {
  await ensureNotificationsInfrastructure(sql);

  await sql`
    UPDATE users
    SET notifications_enabled = ${enabled}
    WHERE id = ${userId}
  `;
}

export async function upsertPushSubscription(
  sql: SqlClient,
  userId: string,
  input: PushSubscriptionInput,
) {
  await ensureNotificationsInfrastructure(sql);

  await sql`
    INSERT INTO push_subscriptions (
      user_id,
      endpoint,
      p256dh,
      auth,
      expiration_time,
      user_agent,
      last_seen_at
    )
    VALUES (
      ${userId},
      ${input.endpoint},
      ${input.keys.p256dh},
      ${input.keys.auth},
      ${input.expirationTime ?? null},
      ${input.userAgent ?? null},
      NOW()
    )
    ON CONFLICT (endpoint) DO UPDATE
    SET
      user_id = EXCLUDED.user_id,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      expiration_time = EXCLUDED.expiration_time,
      user_agent = EXCLUDED.user_agent,
      last_seen_at = NOW()
  `;

  logInfo('push_subscription_upserted', {
    userId,
    endpoint: input.endpoint,
  });
}

export async function deletePushSubscription(sql: SqlClient, userId: string, endpoint: string) {
  await ensureNotificationsInfrastructure(sql);

  const deleted = await sql`
    DELETE FROM push_subscriptions
    WHERE user_id = ${userId}
      AND endpoint = ${endpoint}
    RETURNING id
  `;

  logInfo('push_subscription_deleted', {
    userId,
    endpoint,
    deleted: deleted.length,
  });

  return deleted.length;
}

export async function createNotification(
  sql: SqlClient,
  input: CreateNotificationInput,
): Promise<CreateNotificationResult> {
  await ensureNotificationsInfrastructure(sql);

  const targetType = input.target?.type ?? null;
  const targetTaskId = input.target?.type === 'task' ? input.target.taskId : null;
  const lookupDedupeKey = input.dedupeKey ?? null;
  const lookupSourceScheduleId = input.sourceScheduleId ?? null;

  if (lookupDedupeKey || lookupSourceScheduleId) {
    const existing = await sql`
      SELECT
        id,
        title,
        message,
        created_at AS "createdAt",
        read,
        tone,
        target_type AS "targetType",
        target_task_id AS "targetTaskId",
        dedupe_key AS "dedupeKey",
        source_schedule_id AS "sourceScheduleId",
        kind
      FROM notifications
      WHERE user_id = ${input.userId}
        AND (
          (${lookupDedupeKey}::text IS NOT NULL AND dedupe_key = ${lookupDedupeKey})
          OR (${lookupSourceScheduleId}::uuid IS NOT NULL AND source_schedule_id = ${lookupSourceScheduleId})
        )
      LIMIT 1
    `;

    if (existing.length > 0) {
      const notification = mapNotificationRow(existing[0] as unknown as NotificationRow);
      logInfo('notification_deduplicated_before_insert', {
        userId: input.userId,
        notificationId: notification.id,
        dedupeKey: input.dedupeKey,
        sourceScheduleId: input.sourceScheduleId,
      });
      return { created: false, notification };
    }
  }

  let inserted: unknown[];

  try {
    inserted = await sql`
      INSERT INTO notifications (user_id, title, message, tone, target_type, target_task_id, dedupe_key, source_schedule_id, kind)
      VALUES (
        ${input.userId},
        ${input.title},
        ${input.message},
        ${input.tone},
        ${targetType},
        ${targetTaskId},
        ${input.dedupeKey ?? null},
        ${input.sourceScheduleId ?? null},
        ${input.kind ?? null}
      )
      ON CONFLICT DO NOTHING
      RETURNING
        id,
        title,
        message,
        created_at AS "createdAt",
        read,
        tone,
        target_type AS "targetType",
        target_task_id AS "targetTaskId",
        dedupe_key AS "dedupeKey",
        source_schedule_id AS "sourceScheduleId",
        kind
    `;
  } catch (error) {
    if (isForeignKeyReferenceError(error)) {
      throw new NotificationReferenceUnavailableError();
    }

    throw error;
  }

  if (inserted.length > 0) {
    const notification = mapNotificationRow(inserted[0] as unknown as NotificationRow);
    if (input.sendPush !== false) {
      try {
        await sendPushNotificationToUser(sql, input.userId, notification);
      } catch (error) {
        logError('push_notification_dispatch_failed', error, {
          userId: input.userId,
          notificationId: notification.id,
        });
      }
    }

    return {
      created: true,
      notification,
    };
  }

  if (!input.dedupeKey && !input.sourceScheduleId) {
    throw new Error('Falha ao persistir notificação');
  }

  const existing = await sql`
    SELECT
      id,
      title,
      message,
      created_at AS "createdAt",
      read,
      tone,
      target_type AS "targetType",
      target_task_id AS "targetTaskId",
      dedupe_key AS "dedupeKey",
      source_schedule_id AS "sourceScheduleId",
      kind
    FROM notifications
    WHERE user_id = ${input.userId}
      AND (
        (${lookupDedupeKey}::text IS NOT NULL AND dedupe_key = ${lookupDedupeKey})
        OR (${lookupSourceScheduleId}::uuid IS NOT NULL AND source_schedule_id = ${lookupSourceScheduleId})
      )
    LIMIT 1
  `;

  if (existing.length === 0) {
    throw new Error('Falha ao recuperar notificação existente');
  }

  return {
    created: false,
    notification: mapNotificationRow(existing[0] as unknown as NotificationRow),
  };
}

export async function markNotificationReadState(
  sql: SqlClient,
  userId: string,
  notificationId: string,
  read: boolean,
) {
  await ensureNotificationsInfrastructure(sql);

  const rows = await sql`
    UPDATE notifications
    SET read = ${read}
    WHERE id = ${notificationId} AND user_id = ${userId}
    RETURNING
      id,
      title,
      message,
      created_at AS "createdAt",
      read,
      tone,
      target_type AS "targetType",
      target_task_id AS "targetTaskId",
      dedupe_key AS "dedupeKey",
      source_schedule_id AS "sourceScheduleId",
      kind
  `;

  return rows.length > 0 ? mapNotificationRow(rows[0] as unknown as NotificationRow) : null;
}

export async function markAllNotificationsRead(sql: SqlClient, userId: string) {
  await ensureNotificationsInfrastructure(sql);

  const rows = await sql`
    UPDATE notifications
    SET read = TRUE
    WHERE user_id = ${userId} AND read = FALSE
    RETURNING id
  `;

  return rows.length;
}

export async function clearNotificationsForUser(sql: SqlClient, userId: string) {
  await ensureNotificationsInfrastructure(sql);

  const rows = await sql`
    DELETE FROM notifications
    WHERE user_id = ${userId}
    RETURNING id
  `;

  return rows.length;
}

interface SchedulableTaskRow {
  id: string;
  userId: string;
  title: string;
  dueDate: string | null;
  suppressHolidayNotifications: boolean;
  alarmEnabled: boolean;
  stateCode: string | null;
  cityName: string | null;
  holidayRegionCode: string | null;
}

function minutesDifference(targetDate: Date, referenceDate: Date) {
  return Math.floor((targetDate.getTime() - referenceDate.getTime()) / 60000);
}

export async function generateScheduledNotifications(sql: SqlClient): Promise<ScheduledNotificationSummary> {
  await ensureNotificationsInfrastructure(sql);
  await sql`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS suppress_holiday_notifications BOOLEAN NOT NULL DEFAULT FALSE
  `;

  await sql`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS alarm_enabled BOOLEAN NOT NULL DEFAULT FALSE
  `;

  const rows = await sql`
    SELECT
      tasks.id,
      tasks.user_id AS "userId",
      tasks.title,
      tasks.due_date AS "dueDate",
      tasks.suppress_holiday_notifications AS "suppressHolidayNotifications",
      tasks.alarm_enabled AS "alarmEnabled",
      users.state_code AS "stateCode",
      users.city_name AS "cityName",
      users.holiday_region_code AS "holidayRegionCode"
    FROM tasks
    INNER JOIN users ON users.id = tasks.user_id
    WHERE tasks.status = 'pending'
      AND tasks.due_date IS NOT NULL
      AND users.notifications_enabled = TRUE
  `;

  const tasks = rows as unknown as SchedulableTaskRow[];
  const now = new Date();
  let createdNotifications = 0;

  for (const task of tasks) {
    if (!task.dueDate) continue;

    const dueDate = new Date(task.dueDate);
    if (Number.isNaN(dueDate.getTime())) continue;

    if (
      task.suppressHolidayNotifications &&
      isHolidayForLocationOnDate(
        {
          stateCode: task.stateCode,
          cityName: task.cityName,
          regionCode: task.holidayRegionCode,
        },
        dueDate,
      )
    ) {
      continue;
    }

    const minutesUntil = minutesDifference(dueDate, now);

    if (
      minutesUntil <= UPCOMING_REMINDER_MINUTES &&
      (task.alarmEnabled ? minutesUntil >= 0 : minutesUntil > 0)
    ) {
      const result = await createNotification(sql, {
        userId: task.userId,
        title: task.alarmEnabled
          ? 'Alarme em 15 minutos'
          : `Lembrete em ${minutesUntil} minuto${minutesUntil === 1 ? '' : 's'}`,
        message: task.alarmEnabled
          ? `O alarme do seu lembrete vai tocar em 15 minutos! "${task.title}" está chegando.`
          : `"${task.title}" está chegando. Falta pouco para o horário definido.`,
        tone: task.alarmEnabled || minutesUntil <= 5 ? 'warning' : 'info',
        target: { type: 'task', taskId: task.id },
        dedupeKey: `user:${task.userId}:${task.alarmEnabled ? 'alarm-warning' : 'upcoming'}:${task.id}:${format(dueDate, 'yyyy-MM-dd-HH-mm')}:${UPCOMING_REMINDER_MINUTES}`,
      });

      if (result.created) {
        createdNotifications += 1;
      }
    }

    if (!task.alarmEnabled && minutesUntil === 0) {
      const result = await createNotification(sql, {
        userId: task.userId,
        title: 'Lembrete para agora',
        message: `"${task.title}" chegou ao horÃ¡rio definido.`,
        tone: 'info',
        target: { type: 'task', taskId: task.id },
        dedupeKey: `user:${task.userId}:due:${task.id}:${format(dueDate, 'yyyy-MM-dd-HH-mm')}`,
      });

      if (result.created) {
        createdNotifications += 1;
      }
    }

    if (minutesUntil < 0) {
      const minutesOverdue = Math.abs(minutesUntil);
      const overdueBucket = Math.floor(minutesOverdue / OVERDUE_REMINDER_INTERVAL_MINUTES);
      const result = await createNotification(sql, {
        userId: task.userId,
        title: 'Lembrete atrasado',
        message: overdueBucket === 0
          ? `"${task.title}" passou do prazo e precisa da sua atenção.`
          : `"${task.title}" continua atrasado ha ${minutesOverdue} minuto${minutesOverdue === 1 ? '' : 's'}.`,
        tone: 'warning',
        target: { type: 'task', taskId: task.id },
        dedupeKey: `user:${task.userId}:overdue:${task.id}:${overdueBucket}`,
      });

      if (result.created) {
        createdNotifications += 1;
      }
    }
  }

  return {
    scannedTasks: tasks.length,
    createdNotifications,
  };
}
