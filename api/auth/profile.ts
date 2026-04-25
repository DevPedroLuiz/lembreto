import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import sql from '../_db.js';
import { signToken } from '../../lib/jwt.js';
import {
  buildTokenJti,
  getAuthFailureResponse,
  requireAuthFromAuthorizationHeader,
} from '../../lib/auth.js';
import { profileUpdateSchema, formatZodError } from '../../lib/schemas.js';
import { logError, logInfo } from '../../lib/logger.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT')
    return res.status(405).json({ error: 'Método não permitido' });

  let auth;
  try {
    auth = await requireAuthFromAuthorizationHeader(sql, req.headers.authorization);
  } catch (error) {
    const authFailure = getAuthFailureResponse(error);
    if (authFailure) return res.status(authFailure.status).json({ error: authFailure.error });
    logError('auth_profile_auth_failed', error);
    return res.status(500).json({ error: 'Erro interno ao autenticar' });
  }

  const parsed = profileUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }

  const userId = auth.user.id;
  const { name, email, password, avatar } = parsed.data;

  try {
    if (email) {
      const conflict = await sql`
        SELECT id FROM users
        WHERE email = ${email} AND id != ${userId}
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
    let newPasswordHash = cur.password;
    if (password && password.trim()) {
      newPasswordHash = await bcrypt.hash(password.trim(), 12);
    }

    const nextEmail = email || cur.email;
    const shouldRotateToken =
      Boolean(password && password.trim()) || nextEmail !== auth.user.email;

    const rows = await sql`
      UPDATE users SET
        name     = ${name || cur.name},
        email    = ${nextEmail},
        password = ${newPasswordHash},
        avatar   = ${avatar !== undefined ? avatar : cur.avatar}
      WHERE id = ${userId}
      RETURNING id, name, email, avatar
    `;

    const user = rows[0];

    if (shouldRotateToken) {
      const rotatedToken = signToken({ sub: user.id, email: user.email });

      await sql`
        INSERT INTO token_blacklist (token_jti, user_id, expires_at)
        VALUES (
          ${buildTokenJti(auth.payload)},
          ${auth.payload.sub},
          to_timestamp(${auth.payload.exp ?? 0})
        )
        ON CONFLICT (token_jti) DO NOTHING
      `;

      logInfo('auth_profile_updated_with_token_rotation', { userId: user.id });
      return res.json({ user, token: rotatedToken });
    }

    logInfo('auth_profile_updated', { userId: user.id });
    return res.json({ user });
  } catch (error) {
    logError('auth_profile_update_failed', error, { userId });
    return res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
}
