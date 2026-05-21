import { buildTokenJti } from '../../lib/auth';
import { createSqlClient } from '../../lib/db';
import { processNotificationSchedules } from '../../lib/notification-schedules';
import { createNotification, type NotificationTarget } from '../../lib/notifications';
import { verifyToken } from '../../lib/jwt';
import { createPasswordResetToken } from '../../lib/password-reset';
import type { NotificationScheduleKind, NotificationTone, TaskStatus } from '../../lib/contracts';
import { getRequiredE2EDatabaseUrl } from './e2e-env';

const sql = createSqlClient(getRequiredE2EDatabaseUrl());

export interface E2ETestUser {
  name: string;
  email: string;
  password: string;
  nextPassword: string;
}

export function buildE2ETestUser(): E2ETestUser {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  return {
    name: 'Teste E2E',
    email: `teste-e2e-${nonce}@example.com`,
    password: 'SenhaInicial123!',
    nextPassword: 'SenhaNova123!',
  };
}

async function getUserIdByEmail(email: string): Promise<string> {
  const users = (await sql`
    SELECT id
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `) as Array<{ id: string }>;

  const user = users[0];
  if (!user) {
    throw new Error(`Usuário de teste não encontrado para ${email}`);
  }

  return user.id;
}

export async function cleanupUserByEmail(email: string): Promise<void> {
  const users = (await sql`
    SELECT id
    FROM users
    WHERE email = ${email}
  `) as Array<{ id: string }>;

  for (const user of users) {
    await sql`DELETE FROM users WHERE id = ${user.id}`;
  }
}

export async function cleanupUsersByEmail(emails: string[]): Promise<void> {
  for (const email of emails) {
    await cleanupUserByEmail(email);
  }
}

export async function seedPasswordResetToken(email: string): Promise<string> {
  const userId = await getUserIdByEmail(email);

  await sql`
    UPDATE password_reset_tokens
    SET used = TRUE
    WHERE user_id = ${userId}
  `;

  const { rawToken, tokenHash, expiresAt } = createPasswordResetToken();

  await sql`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt})
  `;

  return rawToken;
}

export async function seedTasksForUser(
  email: string,
  total: number,
  options?: { status?: 'pending' | 'completed'; prefix?: string },
): Promise<void> {
  const userId = await getUserIdByEmail(email);
  const status = options?.status ?? 'pending';
  const prefix = options?.prefix ?? 'Tarefa paginada';

  for (let index = 1; index <= total; index += 1) {
    const dueDate = new Date(Date.now() + index * 60 * 60 * 1000).toISOString();
    await sql`
      INSERT INTO tasks (user_id, title, description, due_date, priority, category, status)
      VALUES (
        ${userId},
        ${`${prefix} ${index}`},
        ${'Gerada automaticamente para teste E2E.'},
        ${dueDate},
        ${'medium'},
        ${'Geral'},
        ${status}
      )
    `;
  }
}

export async function seedCustomTasksForUser(
  email: string,
  tasks: Array<{
    title: string;
    description?: string;
    dueDate: string;
    priority: 'low' | 'medium' | 'high';
    category: string;
    tags?: string[];
    status?: Extract<TaskStatus, 'pending' | 'overdue' | 'completed' | 'draft' | 'inactive'>;
    alarmEnabled?: boolean;
  }>,
): Promise<string[]> {
  const userId = await getUserIdByEmail(email);
  const taskIds: string[] = [];

  for (const task of tasks) {
    const rows = (await sql`
      INSERT INTO tasks (user_id, title, description, due_date, priority, category, tags, alarm_enabled, status)
      VALUES (
        ${userId},
        ${task.title},
        ${task.description ?? 'Gerada automaticamente para teste E2E.'},
        ${task.dueDate},
        ${task.priority},
        ${task.category},
        ${task.tags ?? []},
        ${task.alarmEnabled ?? false},
        ${task.status ?? 'pending'}
      )
      RETURNING id
    `) as Array<{ id: string }>;

    if (rows[0]?.id) {
      taskIds.push(rows[0].id);
    }
  }

  return taskIds;
}

export async function blacklistToken(token: string): Promise<void> {
  const payload = verifyToken(token);

  await sql`
    INSERT INTO token_blacklist (token_jti, user_id, expires_at)
    VALUES (
      ${buildTokenJti(payload)},
      ${payload.sub},
      to_timestamp(${payload.exp ?? 0})
    )
    ON CONFLICT (token_jti) DO NOTHING
  `;
}

export async function seedNotificationForUser(
  email: string,
  input: {
    title: string;
    message: string;
    tone: NotificationTone;
    target?: NotificationTarget | { type: 'notifications' | 'profile' | 'settings' };
    dedupeKey?: string;
  },
): Promise<void> {
  const userId = await getUserIdByEmail(email);

  await createNotification(sql, {
    userId,
    ...input,
  });
}

export async function seedNotificationScheduleForTask(
  email: string,
  taskId: string,
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
): Promise<void> {
  const userId = await getUserIdByEmail(email);
  const dedupeKey = input.dedupeKey ?? [
    'e2e',
    userId,
    taskId,
    input.kind,
    input.notifyAt.getTime(),
    Math.random().toString(16).slice(2),
  ].join(':');

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
      ${userId},
      ${taskId},
      ${input.kind},
      ${input.notifyAt},
      ${input.title},
      ${input.message},
      ${input.tone},
      ${dedupeKey},
      ${input.sequenceIndex ?? null},
      ${input.intervalMinutes ?? null}
    )
  `;
}

export async function runScheduledNotifications(options?: { passes?: number; delayMs?: number }): Promise<void> {
  const passes = options?.passes ?? 2;

  for (let pass = 0; pass < passes; pass += 1) {
    if (pass > 0 && options?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    await processNotificationSchedules(sql);
  }
}
