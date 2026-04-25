import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../../lib/auth.js';
import { updateTaskSchema, formatZodError } from '../../lib/schemas.js';
import { logError, logInfo } from '../../lib/logger.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let auth;
  try {
    auth = await requireAuthFromAuthorizationHeader(sql, req.headers.authorization);
  } catch (error) {
    const authFailure = getAuthFailureResponse(error);
    if (authFailure) return res.status(authFailure.status).json({ error: authFailure.error });
    logError('task_auth_failed', error);
    return res.status(500).json({ error: 'Erro interno ao autenticar' });
  }

  const user = auth.user;
  const { id } = req.query as { id: string };

  if (req.method === 'PUT') {
    const parsed = updateTaskSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: formatZodError(parsed.error) });
    }

    const { title, description, dueDate, priority, category, status } = parsed.data;

    try {
      const current = await sql`
        SELECT title, description, due_date, priority, category, status
        FROM tasks WHERE id = ${id} AND user_id = ${user.id}
      `;
      if (current.length === 0)
        return res.status(404).json({ error: 'Tarefa não encontrada' });

      const cur = current[0];
      const rows = await sql`
        UPDATE tasks SET
          title       = ${title !== undefined ? title : cur.title},
          description = ${description !== undefined ? description : cur.description},
          due_date    = ${dueDate !== undefined ? dueDate || null : cur.due_date},
          priority    = ${priority !== undefined ? priority : cur.priority},
          category    = ${category !== undefined ? category : cur.category},
          status      = ${status !== undefined ? status : cur.status}
        WHERE id = ${id} AND user_id = ${user.id}
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
      logInfo('task_updated', { userId: user.id, taskId: id });
      return res.json(rows[0]);
    } catch (error) {
      logError('task_update_failed', error, { userId: user.id, taskId: id });
      return res.status(500).json({ error: 'Erro ao atualizar tarefa' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await sql`DELETE FROM tasks WHERE id = ${id} AND user_id = ${user.id}`;
      logInfo('task_deleted', { userId: user.id, taskId: id });
      return res.status(204).send('');
    } catch (error) {
      logError('task_delete_failed', error, { userId: user.id, taskId: id });
      return res.status(500).json({ error: 'Erro ao deletar tarefa' });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
}
