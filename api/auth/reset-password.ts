// api/auth/reset-password.ts
// POST /api/auth/reset-password
//
// Valida o token de recuperação e salva a nova senha com bcrypt.
// O token é consumido após o uso (used = TRUE) e nunca pode ser reutilizado.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import sql from '../_db.js';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const { token, password } = req.body ?? {};

  if (!token || typeof token !== 'string')
    return res.status(400).json({ error: 'Token inválido ou ausente' });

  if (!password || typeof password !== 'string' || password.length < 6)
    return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres' });

  try {
    const tokenHash = hashToken(token.trim());

    // Busca token válido: não usado e não expirado
    const rows = await sql`
      SELECT id AS token_id, user_id
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
        AND used        = FALSE
        AND expires_at  > NOW()
    `;

    if (rows.length === 0) {
      return res.status(400).json({
        error: 'Link inválido ou expirado. Solicite um novo link de recuperação.',
      });
    }

    const { token_id, user_id } = rows[0];
    const passwordHash = await bcrypt.hash(password, 12);

    // Atualiza a senha do usuário
    await sql`
      UPDATE users SET password = ${passwordHash} WHERE id = ${user_id}
    `;

    // Consome o token para que não possa ser reutilizado
    await sql`
      UPDATE password_reset_tokens SET used = TRUE WHERE id = ${token_id}
    `;

    console.log(`[reset-password] Senha redefinida para user_id: ${user_id}`);

    return res.status(200).json({
      message: 'Senha redefinida com sucesso! Você já pode fazer login.',
    });
  } catch (e: any) {
    console.error('[reset-password]', e.message);
    return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
}
