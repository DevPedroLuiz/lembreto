import { format } from 'date-fns';
import {
  type NotificationTargetType,
  type NotificationTone,
} from './contracts.js';
import type { SqlClient } from './handlers/core.js';

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
}

export interface CreateNotificationInput {
  userId: string;
  title: string;
  message: string;
  tone: NotificationTone;
  target?: AppNotificationRecord['target'];
  dedupeKey?: string;
}

export interface CreateNotificationResult {
  created: boolean;
  notification: AppNotificationRecord;
}

export interface ScheduledNotificationSummary {
  scannedTasks: number;
  createdNotifications: number;
}

export const UPCOMING_REMINDER_MINUTES = 15;
export const OVERDUE_REMINDER_INTERVAL_MINUTES = 30;

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
  };
}

export async function ensureNotificationsInfrastructure(sql: SqlClient) {
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
      dedupe_key AS "dedupeKey"
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

export async function createNotification(sql: SqlClient, input: CreateNotificationInput): Promise<CreateNotificationResult> {
  await ensureNotificationsInfrastructure(sql);

  const targetType = input.target?.type ?? null;
  const targetTaskId = input.target?.type === 'task' ? input.target.taskId : null;

  const inserted = await sql`
    INSERT INTO notifications (user_id, title, message, tone, target_type, target_task_id, dedupe_key)
    VALUES (
      ${input.userId},
      ${input.title},
      ${input.message},
      ${input.tone},
      ${targetType},
      ${targetTaskId},
      ${input.dedupeKey ?? null}
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING
      id,
      title,
      message,
      created_at AS "createdAt",
      read,
      tone,
      target_type AS "targetType",
      target_task_id AS "targetTaskId",
      dedupe_key AS "dedupeKey"
  `;

  if (inserted.length > 0) {
    return {
      created: true,
      notification: mapNotificationRow(inserted[0] as unknown as NotificationRow),
    };
  }

  if (!input.dedupeKey) {
    throw new Error('Falha ao persistir notificacao');
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
      dedupe_key AS "dedupeKey"
    FROM notifications
    WHERE user_id = ${input.userId} AND dedupe_key = ${input.dedupeKey}
    LIMIT 1
  `;

  if (existing.length === 0) {
    throw new Error('Falha ao recuperar notificacao existente');
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
      dedupe_key AS "dedupeKey"
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
}

function minutesDifference(targetDate: Date, referenceDate: Date) {
  return Math.floor((targetDate.getTime() - referenceDate.getTime()) / 60000);
}

export async function generateScheduledNotifications(sql: SqlClient): Promise<ScheduledNotificationSummary> {
  await ensureNotificationsInfrastructure(sql);

  const rows = await sql`
    SELECT
      tasks.id,
      tasks.user_id AS "userId",
      tasks.title,
      tasks.due_date AS "dueDate"
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

    const minutesUntil = minutesDifference(dueDate, now);

    if (minutesUntil >= 0 && minutesUntil <= UPCOMING_REMINDER_MINUTES) {
      const result = await createNotification(sql, {
        userId: task.userId,
        title: minutesUntil === 0
          ? 'Lembrete para agora'
          : `Lembrete em ${minutesUntil} minuto${minutesUntil === 1 ? '' : 's'}`,
        message: `"${task.title}" esta chegando. Falta pouco para o horario definido.`,
        tone: minutesUntil <= 5 ? 'warning' : 'info',
        target: { type: 'task', taskId: task.id },
        dedupeKey: `user:${task.userId}:upcoming:${task.id}:${format(dueDate, 'yyyy-MM-dd-HH-mm')}:${UPCOMING_REMINDER_MINUTES}`,
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
          ? `"${task.title}" passou do prazo e precisa da sua atencao.`
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
