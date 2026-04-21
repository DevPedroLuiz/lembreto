import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { extractBearerToken, verifyToken } from '../../lib/jwt.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const token = extractBearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const payload = verifyToken(token);

    // Registra o token na blacklist até ele expirar naturalmente
    await sql`
      INSERT INTO token_blacklist (token_jti, user_id, expires_at)
      VALUES (
        ${payload.sub + '_' + (payload.iat ?? 0)},
        ${payload.sub},
        to_timestamp(${payload.exp ?? 0})
      )
      ON CONFLICT (token_jti) DO NOTHING
    `;

    return res.json({ message: 'Logout realizado com sucesso' });
  } catch {
    // Token inválido/expirado — logout silencioso é aceitável
    return res.json({ message: 'Logout realizado com sucesso' });
  }
}
