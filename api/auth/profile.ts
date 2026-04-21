import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT')
    return res.status(405).json({ error: 'Método não permitido' });

  const userId = req.headers['x-user-id'] as string;
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const { name, email, password, avatar } = req.body ?? {};

  try {
    if (email) {
      const conflict = await sql`
        SELECT id FROM users
        WHERE email = ${email.trim().toLowerCase()} AND id != ${userId}
      `;
      if (conflict.length > 0)
        return res.status(400).json({ error: 'Este email já está em uso' });
    }

    const current = await sql`
      SELECT name, email, password, avatar FROM users WHERE id = ${userId}
    `;
    if (current.length === 0)
      return res.status(404).json({ error: 'Usuário não encontrado' });

    const cur = current[0];
    const rows = await sql`
      UPDATE users SET
        name     = ${(name     && name.trim())               || cur.name},
        email    = ${(email    && email.trim().toLowerCase()) || cur.email},
        password = ${(password && password.trim())            || cur.password},
        avatar   = ${avatar !== undefined ? avatar : cur.avatar}
      WHERE id = ${userId}
      RETURNING id, name, email, avatar
    `;
    return res.json({ user: rows[0] });
  } catch (e: any) {
    console.error('[profile]', e.message);
    return res.status(500).json({ error: `Erro ao atualizar perfil: ${e.message}` });
  }
}
