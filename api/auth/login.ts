import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const { email, password } = req.body ?? {};
  if (!email || !password)
    return res.status(400).json({ error: 'Preencha todos os campos' });

  try {
    const rows = await sql`
      SELECT id, name, email, avatar
      FROM users
      WHERE email = ${email.trim().toLowerCase()} AND password = ${password}
    `;
    if (rows.length === 0)
      return res.status(401).json({ error: 'Email ou senha incorretos' });

    return res.json({ user: rows[0], token: rows[0].id });
  } catch (e: any) {
    console.error('[login]', e.message);
    return res.status(500).json({ error: `Erro interno: ${e.message}` });
  }
}
