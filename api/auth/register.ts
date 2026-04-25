import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import sql from '../_db.js';
import { signToken } from '../../lib/jwt.js';
import { checkRateLimit, clearRateLimit } from '../_rate_limit.js';
import { registerSchema, formatZodError } from '../../lib/schemas.js';
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
  const rl = await checkRateLimit(ip, 'register');
  if (!rl.allowed) {
    const minutes = Math.ceil((rl.retryAfterSeconds ?? 60) / 60);
    logWarn('auth_register_rate_limited', { ip, retryAfterSeconds: rl.retryAfterSeconds });
    return res.status(429).json({
      error: `Muitas tentativas. Tente novamente em ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
      retryAfterSeconds: rl.retryAfterSeconds,
    });
  }

  const parsed = registerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: formatZodError(parsed.error) });
  }

  const { name, email, password } = parsed.data;

  try {
    const existing = await sql`
      SELECT id FROM users WHERE email = ${email}
    `;
    if (existing.length > 0)
      return res.status(400).json({ error: 'Este email já está em uso' });

    const hashedPassword = await bcrypt.hash(password, 12);

    const rows = await sql`
      INSERT INTO users (name, email, password)
      VALUES (${name}, ${email}, ${hashedPassword})
      RETURNING id, name, email, avatar
    `;
    const user = rows[0];

    await clearRateLimit(ip, 'register');

    const token = signToken({ sub: user.id, email: user.email });
    logInfo('auth_register_success', { userId: user.id, ip });

    return res.status(201).json({ user, token });
  } catch (error) {
    logError('auth_register_failed', error, { ip, email });
    return res.status(500).json({ error: 'Erro ao criar usuário' });
  }
}
