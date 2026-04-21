import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import sql from '../_db.js';
import { signToken } from '../../lib/jwt.js';
import { checkRateLimit, clearRateLimit } from '../_rate_limit.js';

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

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const rl = await checkRateLimit(ip, 'login');
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds! / 60);
    return res.status(429).json({
      error: `Muitas tentativas. Tente novamente em ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
      retryAfterSeconds: rl.retryAfterSeconds,
    });
  }

  const { email, password } = req.body ?? {};
  if (!email || !password)
    return res.status(400).json({ error: 'Preencha todos os campos' });

  try {
    const rows = await sql`
      SELECT id, name, email, avatar, password AS password_hash
      FROM users
      WHERE email = ${email.trim().toLowerCase()}
    `;

    // Resposta genérica — não revela se o e-mail existe (evita user enumeration)
    if (rows.length === 0)
      return res.status(401).json({ error: 'Email ou senha incorretos' });

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch)
      return res.status(401).json({ error: 'Email ou senha incorretos' });

    // Login bem-sucedido: limpa o histórico de tentativas deste IP
    await clearRateLimit(ip, 'login');

    const { password_hash: _, ...safeUser } = user;
    const token = signToken({ sub: safeUser.id, email: safeUser.email });

    return res.json({ user: safeUser, token });
  } catch (e: any) {
    console.error('[login]', e.message);
    return res.status(500).json({ error: `Erro interno: ${e.message}` });
  }
}
