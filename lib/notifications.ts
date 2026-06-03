import { createHash } from 'node:crypto';
import webpush from 'web-push';
import {
  type NotificationScheduleKind,
  type NotificationTargetType,
  type NotificationTone,
} from './contracts.js';
import type { SqlClient } from './handlers/core.js';
import { assertInfrastructure } from './infrastructure.js';
import { logError, logInfo, logWarn } from './logger.js';

const DEFAULT_PUSH_SEND_TIMEOUT_MS = 3000;
const TEMPORARY_PUSH_RETRY_ATTEMPTS = 2;
const TEMPORARY_PUSH_RETRY_DELAY_MS = 750;
const DEFAULT_TEMPORARY_PUSH_RETRY_LIMIT = 20;
const MAX_TEMPORARY_PUSH_DELIVERY_ATTEMPTS = 4;

export function getPushSendTimeoutMs() {
  const configured = Number(process.env.PUSH_SEND_TIMEOUT_MS ?? DEFAULT_PUSH_SEND_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PUSH_SEND_TIMEOUT_MS;
}

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
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

interface PushRetryRow extends PushSubscriptionRow {
  userId: string;
  notificationId: string;
  notificationTitle: string;
  notificationMessage: string;
  notificationCreatedAt: string;
  notificationRead: boolean;
  notificationTone: NotificationTone;
  targetType: NotificationTargetType | null;
  targetTaskId: string | null;
  dedupeKey: string | null;
  sourceScheduleId: string | null;
  kind: NotificationScheduleKind | null;
  lastError: string | null;
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
  ensureInfrastructure?: boolean;
}

export interface CreateNotificationResult {
  created: boolean;
  notification: AppNotificationRecord;
}

export interface NotificationListFilters {
  search?: string;
  read?: boolean | null;
  tone?: NotificationTone | null;
  kind?: NotificationScheduleKind | null;
  createdFrom?: string | null;
  createdTo?: string | null;
}

export interface ListNotificationsOptions extends NotificationListFilters {
  cursor?: string | null;
  limit?: number;
}

export interface NotificationPageInfo {
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}

export interface ListNotificationsResult {
  notifications: AppNotificationRecord[];
  pageInfo: NotificationPageInfo;
}

export class NotificationCursorError extends Error {
  constructor(message = 'Invalid notification cursor') {
    super(message);
    this.name = 'NotificationCursorError';
  }
}

export class NotificationReferenceUnavailableError extends Error {
  constructor(message = 'Notification reference unavailable') {
    super(message);
    this.name = 'NotificationReferenceUnavailableError';
  }
}

const DEFAULT_NOTIFICATION_LIST_LIMIT = 50;
const MAX_NOTIFICATION_LIST_LIMIT = 100;

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

function hashPushEndpoint(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex');
}

function getPushDeliveryError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return String(error ?? 'push_delivery_failed').slice(0, 1000);
  }

  const maybeError = error as { message?: unknown; body?: unknown; statusCode?: unknown };
  const statusCode = typeof maybeError.statusCode === 'number' ? `status_${maybeError.statusCode}` : null;
  const message = typeof maybeError.message === 'string' ? maybeError.message : null;
  const body = typeof maybeError.body === 'string' ? maybeError.body : null;
  return [statusCode, message, body].filter(Boolean).join(': ').slice(0, 1000) || 'push_delivery_failed';
}

function getPushDeliveryStatusCode(error: unknown) {
  return typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
    ? (error as { statusCode: number }).statusCode
    : null;
}

function isTemporaryPushDeliveryError(error: unknown) {
  const statusCode = getPushDeliveryStatusCode(error);
  if (statusCode === null) return true;
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

function looksLikeTemporaryPushDeliveryError(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') return true;
  if (!value.startsWith('status_')) return true;
  return value.startsWith('status_408') ||
    value.startsWith('status_425') ||
    value.startsWith('status_429') ||
    /^status_5\d\d/.test(value);
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeNotificationListLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) return DEFAULT_NOTIFICATION_LIST_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_NOTIFICATION_LIST_LIMIT)), MAX_NOTIFICATION_LIST_LIMIT);
}

function normalizeNullableDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function encodeNotificationCursor(row: AppNotificationRecord) {
  return Buffer.from(JSON.stringify({
    createdAt: row.createdAt,
    id: row.id,
  }), 'utf8').toString('base64url');
}

function decodeNotificationCursor(cursor: string | null | undefined) {
  if (!cursor) return { createdAt: null as string | null, id: null as string | null };

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
      throw new NotificationCursorError();
    }
    const createdAt = normalizeNullableDate(parsed.createdAt);
    if (!createdAt) throw new NotificationCursorError();
    return { createdAt, id: parsed.id };
  } catch (error) {
    if (error instanceof NotificationCursorError) throw error;
    throw new NotificationCursorError();
  }
}

async function recordPushDeliveryAttempt(
  sql: SqlClient,
  userId: string,
  notificationId: string | undefined,
  subscription: PushSubscriptionRow,
) {
  if (!notificationId) return null;

  try {
    const endpointHash = hashPushEndpoint(subscription.endpoint);
    const rows = await sql`
      INSERT INTO notification_deliveries (
        notification_id,
        user_id,
        push_subscription_id,
        endpoint_hash,
        endpoint,
        user_agent,
        status,
        attempt_count,
        attempted_at,
        updated_at
      )
      VALUES (
        ${notificationId},
        ${userId},
        ${subscription.id},
        ${endpointHash},
        ${subscription.endpoint},
        ${subscription.userAgent},
        'attempted',
        1,
        NOW(),
        NOW()
      )
      ON CONFLICT (notification_id, endpoint_hash)
      DO UPDATE SET
        push_subscription_id = EXCLUDED.push_subscription_id,
        endpoint = EXCLUDED.endpoint,
        user_agent = EXCLUDED.user_agent,
        status = 'attempted',
        attempt_count = notification_deliveries.attempt_count + 1,
        attempted_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
      RETURNING id
    `;
    return rows[0]?.id ? String(rows[0].id) : null;
  } catch (error) {
    logError('push_delivery_attempt_record_failed', error, {
      userId,
      notificationId,
      endpoint: subscription.endpoint,
    });
    return null;
  }
}

async function updatePushDeliveryStatus(
  sql: SqlClient,
  deliveryId: string | null,
  status: 'delivered' | 'failed',
  lastError?: string,
) {
  if (!deliveryId) return;

  try {
    await sql`
      UPDATE notification_deliveries
      SET
        status = ${status},
        delivered_at = CASE WHEN ${status} = 'delivered' THEN NOW() ELSE delivered_at END,
        failed_at = CASE WHEN ${status} = 'failed' THEN NOW() ELSE failed_at END,
        last_error = ${lastError ?? null},
        updated_at = NOW()
      WHERE id = ${deliveryId}
    `;
  } catch (error) {
    logError('push_delivery_status_update_failed', error, {
      deliveryId,
      status,
    });
  }
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

  const rows = await sql`
    SELECT
      id,
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
      let deliveryId: string | null = null;
      let attempt = 0;
      try {
        while (true) {
          attempt += 1;
          deliveryId = await recordPushDeliveryAttempt(sql, userId, notificationId, subscription);
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
              { timeout: getPushSendTimeoutMs() },
            );
            break;
          } catch (error) {
            if (!isTemporaryPushDeliveryError(error) || attempt > TEMPORARY_PUSH_RETRY_ATTEMPTS) {
              throw error;
            }
            logWarn('push_notification_temporary_failure_retrying', {
              userId,
              endpoint: subscription.endpoint,
              notificationId,
              deliveryId,
              attempt,
              maxAttempts: TEMPORARY_PUSH_RETRY_ATTEMPTS + 1,
              error: getPushDeliveryError(error),
            });
            await delay(TEMPORARY_PUSH_RETRY_DELAY_MS * attempt);
          }
        }
        await updatePushDeliveryStatus(sql, deliveryId, 'delivered');
      } catch (error) {
        const deliveryError = getPushDeliveryError(error);
        const statusCode = getPushDeliveryStatusCode(error);

        await updatePushDeliveryStatus(sql, deliveryId, 'failed', deliveryError);

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
          deliveryId,
        });
      }
    }),
  );
}

export async function retryTemporaryPushDeliveries(sql: SqlClient, limit = DEFAULT_TEMPORARY_PUSH_RETRY_LIMIT) {
  await ensureNotificationsInfrastructure(sql);
  const client = getWebPushClient();
  if (!client) {
    return { scanned: 0, retried: 0, delivered: 0, failed: 0, skipped: 0 };
  }

  const retryLimit = Math.min(Math.max(1, Math.floor(limit)), DEFAULT_TEMPORARY_PUSH_RETRY_LIMIT);
  const rows = await sql`
    SELECT
      deliveries.user_id AS "userId",
      deliveries.notification_id AS "notificationId",
      subscriptions.id,
      subscriptions.endpoint,
      subscriptions.p256dh,
      subscriptions.auth,
      subscriptions.user_agent AS "userAgent",
      notifications.title AS "notificationTitle",
      notifications.message AS "notificationMessage",
      notifications.created_at AS "notificationCreatedAt",
      notifications.read AS "notificationRead",
      notifications.tone AS "notificationTone",
      notifications.target_type AS "targetType",
      notifications.target_task_id AS "targetTaskId",
      notifications.dedupe_key AS "dedupeKey",
      notifications.source_schedule_id AS "sourceScheduleId",
      notifications.kind,
      deliveries.last_error AS "lastError"
    FROM notification_deliveries deliveries
    INNER JOIN notifications ON notifications.id = deliveries.notification_id
    INNER JOIN push_subscriptions subscriptions ON subscriptions.id = deliveries.push_subscription_id
    WHERE deliveries.status = 'failed'
      AND deliveries.attempt_count < ${MAX_TEMPORARY_PUSH_DELIVERY_ATTEMPTS}
      AND deliveries.failed_at <= NOW() - INTERVAL '1 minute'
      AND (
        deliveries.last_error IS NULL
        OR deliveries.last_error NOT LIKE 'status_%'
        OR deliveries.last_error LIKE 'status_408%'
        OR deliveries.last_error LIKE 'status_425%'
        OR deliveries.last_error LIKE 'status_429%'
        OR deliveries.last_error ~ '^status_5[0-9][0-9]'
      )
    ORDER BY deliveries.failed_at ASC NULLS FIRST
    LIMIT ${retryLimit}
  `;

  let retried = 0;
  let delivered = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows as unknown as PushRetryRow[]) {
    if (!looksLikeTemporaryPushDeliveryError(row.lastError)) {
      skipped += 1;
      continue;
    }

    const notification = mapNotificationRow({
      id: row.notificationId,
      title: row.notificationTitle,
      message: row.notificationMessage,
      createdAt: new Date(String(row.notificationCreatedAt)).toISOString(),
      read: Boolean(row.notificationRead),
      tone: row.notificationTone,
      targetType: row.targetType,
      targetTaskId: row.targetTaskId,
      dedupeKey: row.dedupeKey,
      sourceScheduleId: row.sourceScheduleId,
      kind: row.kind,
    });
    const payload = JSON.stringify(buildPushPayload(notification));
    const deliveryId = await recordPushDeliveryAttempt(sql, row.userId, row.notificationId, row);
    retried += 1;

    try {
      await client.sendNotification(
        {
          endpoint: row.endpoint,
          keys: {
            p256dh: row.p256dh,
            auth: row.auth,
          },
        },
        payload,
        { timeout: getPushSendTimeoutMs() },
      );
      await updatePushDeliveryStatus(sql, deliveryId, 'delivered');
      delivered += 1;
    } catch (error) {
      const deliveryError = getPushDeliveryError(error);
      const statusCode = getPushDeliveryStatusCode(error);
      await updatePushDeliveryStatus(sql, deliveryId, 'failed', deliveryError);
      failed += 1;

      if (statusCode === 404 || statusCode === 410) {
        await sql`
          DELETE FROM push_subscriptions
          WHERE endpoint = ${row.endpoint}
        `;
        logWarn('push_subscription_removed_stale', {
          userId: row.userId,
          endpoint: row.endpoint,
          statusCode,
        });
      }
    }
  }

  if (retried > 0 || skipped > 0) {
    logInfo('temporary_push_deliveries_retried', {
      scanned: rows.length,
      retried,
      delivered,
      failed,
      skipped,
    });
  }

  return {
    scanned: rows.length,
    retried,
    delivered,
    failed,
    skipped,
  };
}

export async function ensureNotificationsInfrastructure(sql: SqlClient) {
  if (!ensureNotificationsInfrastructurePromise) {
    ensureNotificationsInfrastructurePromise = (async () => {
      await assertInfrastructure(sql, 'notifications', {
        relations: [
          { name: 'notifications' },
          { name: 'notification_deliveries' },
          { name: 'push_subscriptions' },
        ],
        columns: [
          { table: 'users', column: 'notifications_enabled' },
          { table: 'notifications', column: 'user_id' },
          { table: 'notifications', column: 'title' },
          { table: 'notifications', column: 'message' },
          { table: 'notifications', column: 'tone' },
          { table: 'notifications', column: 'read' },
          { table: 'notifications', column: 'target_type' },
          { table: 'notifications', column: 'target_task_id' },
          { table: 'notifications', column: 'dedupe_key' },
          { table: 'notifications', column: 'source_schedule_id' },
          { table: 'notifications', column: 'kind' },
          { table: 'notifications', column: 'created_at' },
          { table: 'notification_deliveries', column: 'notification_id' },
          { table: 'notification_deliveries', column: 'user_id' },
          { table: 'notification_deliveries', column: 'push_subscription_id' },
          { table: 'notification_deliveries', column: 'endpoint_hash' },
          { table: 'notification_deliveries', column: 'endpoint' },
          { table: 'notification_deliveries', column: 'user_agent' },
          { table: 'notification_deliveries', column: 'status' },
          { table: 'notification_deliveries', column: 'attempt_count' },
          { table: 'notification_deliveries', column: 'attempted_at' },
          { table: 'notification_deliveries', column: 'delivered_at' },
          { table: 'notification_deliveries', column: 'failed_at' },
          { table: 'notification_deliveries', column: 'last_error' },
          { table: 'push_subscriptions', column: 'user_id' },
          { table: 'push_subscriptions', column: 'endpoint' },
          { table: 'push_subscriptions', column: 'p256dh' },
          { table: 'push_subscriptions', column: 'auth' },
          { table: 'push_subscriptions', column: 'expiration_time' },
          { table: 'push_subscriptions', column: 'user_agent' },
          { table: 'push_subscriptions', column: 'last_seen_at' },
        ],
        indexes: [
          { name: 'idx_notifications_user_created' },
          { name: 'idx_notifications_user_read' },
          { name: 'idx_notifications_user_dedupe' },
          { name: 'idx_notifications_source_schedule' },
          { name: 'idx_notification_deliveries_notification' },
          { name: 'idx_notification_deliveries_user_created' },
          { name: 'idx_notification_deliveries_status' },
          { name: 'idx_push_subscriptions_user_seen' },
        ],
      });
    })().catch((error) => {
      ensureNotificationsInfrastructurePromise = null;
      throw error;
    });
  }

  await ensureNotificationsInfrastructurePromise;
}

export async function listNotificationsForUser(
  sql: SqlClient,
  userId: string,
  options: ListNotificationsOptions = {},
): Promise<ListNotificationsResult> {
  await ensureNotificationsInfrastructure(sql);

  const limit = normalizeNotificationListLimit(options.limit);
  const queryLimit = limit + 1;
  const search = options.search?.trim() ? options.search.trim() : null;
  const read = options.read ?? null;
  const tone = options.tone ?? null;
  const kind = options.kind ?? null;
  const createdFrom = normalizeNullableDate(options.createdFrom);
  const createdTo = normalizeNullableDate(options.createdTo);
  const cursor = decodeNotificationCursor(options.cursor);

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
      AND (${search}::text IS NULL OR title ILIKE '%' || ${search}::text || '%' OR message ILIKE '%' || ${search}::text || '%')
      AND (${read}::boolean IS NULL OR read = ${read}::boolean)
      AND (${tone}::text IS NULL OR tone = ${tone})
      AND (${kind}::text IS NULL OR kind = ${kind})
      AND (${createdFrom}::timestamptz IS NULL OR created_at >= ${createdFrom}::timestamptz)
      AND (${createdTo}::timestamptz IS NULL OR created_at <= ${createdTo}::timestamptz)
      AND (
        ${cursor.createdAt}::timestamptz IS NULL
        OR created_at < ${cursor.createdAt}::timestamptz
        OR (created_at = ${cursor.createdAt}::timestamptz AND id < ${cursor.id}::uuid)
      )
    ORDER BY created_at DESC
    LIMIT ${queryLimit}
  `;

  const notifications = rows.slice(0, limit).map((row) => mapNotificationRow(row as unknown as NotificationRow));
  const lastNotification = notifications.at(-1);

  return {
    notifications,
    pageInfo: {
      hasMore: rows.length > limit,
      nextCursor: rows.length > limit && lastNotification ? encodeNotificationCursor(lastNotification) : null,
      limit,
    },
  };
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
  if (input.ensureInfrastructure !== false) {
    await ensureNotificationsInfrastructure(sql);
  }

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

export async function clearNotificationsForUser(
  sql: SqlClient,
  userId: string,
  filters: NotificationListFilters = {},
) {
  await ensureNotificationsInfrastructure(sql);

  const search = filters.search?.trim() ? filters.search.trim() : null;
  const read = filters.read ?? null;
  const tone = filters.tone ?? null;
  const kind = filters.kind ?? null;
  const createdFrom = normalizeNullableDate(filters.createdFrom);
  const createdTo = normalizeNullableDate(filters.createdTo);

  const deleteMatchingNotifications = async (client: SqlClient) => {
    await client`
      DELETE FROM notification_deliveries
      WHERE notification_id IN (
        SELECT id
        FROM notifications
        WHERE user_id = ${userId}
          AND (${search}::text IS NULL OR title ILIKE '%' || ${search}::text || '%' OR message ILIKE '%' || ${search}::text || '%')
          AND (${read}::boolean IS NULL OR read = ${read}::boolean)
          AND (${tone}::text IS NULL OR tone = ${tone})
          AND (${kind}::text IS NULL OR kind = ${kind})
          AND (${createdFrom}::timestamptz IS NULL OR created_at >= ${createdFrom}::timestamptz)
          AND (${createdTo}::timestamptz IS NULL OR created_at <= ${createdTo}::timestamptz)
      )
    `;

    const rows = await client`
      DELETE FROM notifications
      WHERE user_id = ${userId}
        AND (${search}::text IS NULL OR title ILIKE '%' || ${search}::text || '%' OR message ILIKE '%' || ${search}::text || '%')
        AND (${read}::boolean IS NULL OR read = ${read}::boolean)
        AND (${tone}::text IS NULL OR tone = ${tone})
        AND (${kind}::text IS NULL OR kind = ${kind})
        AND (${createdFrom}::timestamptz IS NULL OR created_at >= ${createdFrom}::timestamptz)
        AND (${createdTo}::timestamptz IS NULL OR created_at <= ${createdTo}::timestamptz)
      RETURNING id
    `;

    return rows.length;
  };

  return sql.begin
    ? sql.begin(deleteMatchingNotifications)
    : deleteMatchingNotifications(sql);
}
