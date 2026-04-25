import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { extractBearerToken, verifyToken } from '../../lib/jwt.js';
import { buildTokenJti } from '../../lib/auth.js';
import { logInfo, logWarn } from '../../lib/logger.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const token = extractBearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const payload = verifyToken(token);

    await sql`
      INSERT INTO token_blacklist (token_jti, user_id, expires_at)
      VALUES (
        ${buildTokenJti(payload)},
        ${payload.sub},
        to_timestamp(${payload.exp ?? 0})
      )
      ON CONFLICT (token_jti) DO NOTHING
    `;

    logInfo('auth_logout_success', { userId: payload.sub });
    return res.json({ message: 'Logout realizado com sucesso' });
  } catch {
    logWarn('auth_logout_with_invalid_token');
    return res.json({ message: 'Logout realizado com sucesso' });
  }
}
