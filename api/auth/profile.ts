import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import sql from '../_db.js';
import { extractBearerToken, verifyToken } from '../../lib/jwt.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT')
    return res.status(405).json({ error: 'Método não permitido' });

  // Valida o JWT no header Authorization
  const token = extractBearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'Não autorizado' });

  let userId: string;
  try {
    const payload = verifyToken(token);
    userId = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const { name, email, password, avatar } = req.body ?? {};

  if (password !== undefined && password !== '' && password.length < 6)
    return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres' });

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

    // Só gera novo hash se uma nova senha foi fornecida
    let newPasswordHash = cur.password;
    if (password && password.trim()) {
      newPasswordHash = await bcrypt.hash(password.trim(), 12);
    }

    const rows = await sql`
      UPDATE users SET
        name     = ${(name     && name.trim())               || cur.name},
        email    = ${(email    && email.trim().toLowerCase()) || cur.email},
        password = ${newPasswordHash},
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
