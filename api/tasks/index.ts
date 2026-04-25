import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../../lib/auth.js';
import { createTaskSchema, formatZodError } from '../../lib/schemas.js';
import { logError, logInfo } from '../../lib/logger.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let auth;
  try {
    auth = await requireAuthFromAuthorizationHeader(sql, req.headers.authorization);
  } catch (error) {
    const authFailure = getAuthFailureResponse(error);
    if (authFailure) return res.status(authFailure.status).json({ error: authFailure.error });
    logError('tasks_auth_failed', error);
    return res.status(500).json({ error: 'Erro interno ao autenticar' });
  }

  const user = auth.user;

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT
          id,
          user_id     AS "userId",
          title,
          description,
          due_date    AS "dueDate",
          priority,
          category,
          status,
          created_at  AS "createdAt"
        FROM tasks
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC
      `;
      return res.json(rows);
    } catch (error) {
      logError('tasks_list_failed', error, { userId: user.id });
      return res.status(500).json({ error: 'Erro ao buscar tarefas' });
    }
  }

  if (req.method === 'POST') {
    const parsed = createTaskSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: formatZodError(parsed.error) });
    }

    const { title, description, dueDate, priority, category } = parsed.data;

    try {
      const rows = await sql`
        INSERT INTO tasks (user_id, title, description, due_date, priority, category)
        VALUES (
          ${user.id},
          ${title},
          ${description},
          ${dueDate || null},
          ${priority},
          ${category}
        )
        RETURNING
          id,
          user_id     AS "userId",
          title,
          description,
          due_date    AS "dueDate",
          priority,
          category,
          status,
          created_at  AS "createdAt"
      `;
      logInfo('task_created', { userId: user.id });
      return res.status(201).json(rows[0]);
    } catch (error) {
      logError('task_create_failed', error, { userId: user.id });
      return res.status(500).json({ error: 'Erro ao criar tarefa' });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
}
