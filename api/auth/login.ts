import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import sql from '../_db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const { email, password } = req.body ?? {};
  if (!email || !password)
    return res.status(400).json({ error: 'Preencha todos os campos' });

  try {
    // Busca o usuário incluindo o hash para comparação
    const rows = await sql`
      SELECT id, name, email, avatar, password AS password_hash
      FROM users
      WHERE email = ${email.trim().toLowerCase()}
    `;

    // Resposta genérica para não revelar se o email existe (evita user enumeration)
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    // Remove o hash antes de retornar os dados ao cliente
    const { password_hash: _, ...safeUser } = user;
    return res.json({ user: safeUser, token: safeUser.id });
  } catch (e: any) {
    console.error('[login]', e.message);
    return res.status(500).json({ error: `Erro interno: ${e.message}` });
  }
}
