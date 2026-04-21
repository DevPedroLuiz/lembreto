import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';

async function getAuthUser(userId: string) {
  const rows = await sql`SELECT id FROM users WHERE id = ${userId}`;
  return rows[0] ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const user = await getAuthUser(userId);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });

  const { id } = req.query as { id: string };

  // PUT /api/tasks/:id
  if (req.method === 'PUT') {
    const { title, description, dueDate, priority, category, status } = req.body ?? {};

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
          title       = ${title       !== undefined ? title.trim()    : cur.title},
          description = ${description !== undefined ? description     : cur.description},
          due_date    = ${dueDate     !== undefined ? dueDate || null  : cur.due_date},
          priority    = ${priority    !== undefined ? priority        : cur.priority},
          category    = ${category    !== undefined ? category        : cur.category},
          status      = ${status      !== undefined ? status          : cur.status}
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
      return res.json(rows[0]);
    } catch (e: any) {
      console.error('[PUT /tasks/:id]', e.message);
      return res.status(500).json({ error: `Erro ao atualizar tarefa: ${e.message}` });
    }
  }

  // DELETE /api/tasks/:id
  if (req.method === 'DELETE') {
    try {
      await sql`DELETE FROM tasks WHERE id = ${id} AND user_id = ${user.id}`;
      return res.status(204).send('');
    } catch (e: any) {
      console.error('[DELETE /tasks/:id]', e.message);
      return res.status(500).json({ error: `Erro ao deletar tarefa: ${e.message}` });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
}
