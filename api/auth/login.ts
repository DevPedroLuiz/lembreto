import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import sql from '../_db.js';
import { signToken } from '../../lib/jwt.js';
import { checkRateLimit, clearRateLimit } from '../_rate_limit.js';
import { loginSchema, formatZodError } from '../../lib/schemas.js';
import { logError, logInfo, logWarn } from '../../lib/logger.js';

function getIP(req: VercelRequest): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ??
    (req.socket as any)?.remoteAddress ??
    'unknown'
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const ip = getIP(req);
  const rl = await checkRateLimit(ip, 'login');
  if (!rl.allowed) {
    const minutes = Math.ceil((rl.retryAfterSeconds ?? 60) / 60);
    logWarn('auth_login_rate_limited', { ip, retryAfterSeconds: rl.retryAfterSeconds });
    return res.status(429).json({
      error: `Muitas tentativas. Tente novamente em ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
      retryAfterSeconds: rl.retryAfterSeconds,
    });
  }

  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }

  const { email, password } = parsed.data;

  try {
    const rows = await sql`
      SELECT id, name, email, avatar, password AS password_hash
      FROM users
      WHERE email = ${email}
    `;

    if (rows.length === 0)
      return res.status(401).json({ error: 'Email ou senha incorretos' });

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch)
      return res.status(401).json({ error: 'Email ou senha incorretos' });

    await clearRateLimit(ip, 'login');

    const { password_hash: _passwordHash, ...safeUser } = user;
    const token = signToken({ sub: safeUser.id, email: safeUser.email });

    logInfo('auth_login_success', { userId: safeUser.id, ip });
    return res.json({ user: safeUser, token });
  } catch (error) {
    logError('auth_login_failed', error, { ip, email });
    return res.status(500).json({ error: 'Erro interno' });
  }
}
