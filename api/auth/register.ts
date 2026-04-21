import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const { name, email, password } = req.body ?? {};
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Preencha todos os campos' });

  try {
    const existing = await sql`
      SELECT id FROM users WHERE email = ${email.trim().toLowerCase()}
    `;
    if (existing.length > 0)
      return res.status(400).json({ error: 'Este email já está em uso' });

    const rows = await sql`
      INSERT INTO users (name, email, password)
      VALUES (${name.trim()}, ${email.trim().toLowerCase()}, ${password})
      RETURNING id, name, email, avatar
    `;
    return res.status(201).json({ user: rows[0], token: rows[0].id });
  } catch (e: any) {
    console.error('[register]', e.message);
    return res.status(500).json({ error: `Erro ao criar usuário: ${e.message}` });
  }
}
