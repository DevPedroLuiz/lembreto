import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import sql from '../_db.js';
import { signToken } from '../../lib/jwt.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const { name, email, password } = req.body ?? {};
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Preencha todos os campos' });

  if (password.length < 6)
    return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres' });

  try {
    const existing = await sql`
      SELECT id FROM users WHERE email = ${email.trim().toLowerCase()}
    `;
    if (existing.length > 0)
      return res.status(400).json({ error: 'Este email já está em uso' });

    const passwordHash = await bcrypt.hash(password, 12);

    const rows = await sql`
      INSERT INTO users (name, email, password)
      VALUES (${name.trim()}, ${email.trim().toLowerCase()}, ${passwordHash})
      RETURNING id, name, email, avatar
    `;
    const user = rows[0];

    // Gera JWT assinado — payload contém apenas id e email, nunca a senha
    const token = signToken({ sub: user.id, email: user.email });

    return res.status(201).json({ user, token });
  } catch (e: any) {
    console.error('[register]', e.message);
    return res.status(500).json({ error: `Erro ao criar usuário: ${e.message}` });
  }
}
