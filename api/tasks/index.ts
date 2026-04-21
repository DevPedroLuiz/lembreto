import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { extractBearerToken, verifyToken } from '../../lib/jwt.js';

async function getAuthUser(userId: string) {
  const rows = await sql`SELECT id FROM users WHERE id = ${userId}`;
  return rows[0] ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Valida o JWT no header Authorization: Bearer <token>
  const token = extractBearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'Não autorizado' });

  let userId: string;
  try {
    const payload = verifyToken(token);
    userId = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const user = await getAuthUser(userId);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });

  // GET /api/tasks
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
    } catch (e: any) {
      console.error('[GET /tasks]', e.message);
      return res.status(500).json({ error: `Erro ao buscar tarefas: ${e.message}` });
    }
  }

  // POST /api/tasks
  if (req.method === 'POST') {
    const { title, description, dueDate, priority, category } = req.body ?? {};
    if (!title?.trim())
      return res.status(400).json({ error: 'Título obrigatório' });

    try {
      const rows = await sql`
        INSERT INTO tasks (user_id, title, description, due_date, priority, category)
        VALUES (
          ${user.id},
          ${title.trim()},
          ${description || ''},
          ${dueDate || null},
          ${priority  || 'medium'},
          ${category  || 'Geral'}
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
      return res.status(201).json(rows[0]);
    } catch (e: any) {
      console.error('[POST /tasks]', e.message);
      return res.status(500).json({ error: `Erro ao criar tarefa: ${e.message}` });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
}
