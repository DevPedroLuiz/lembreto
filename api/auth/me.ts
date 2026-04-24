// api/auth/me.ts
// GET  /api/auth/me  — retorna o usuário autenticado pelo cookie de sessão
// POST /api/auth/me  — salva o token em cookie HttpOnly (chamado após login/register)
// DELETE /api/auth/me — apaga o cookie (chamado no logout)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { extractBearerToken, verifyToken } from '../../lib/jwt.js';

const COOKIE_NAME = 'lembreto_session';
const IS_PROD = process.env.NODE_ENV === 'production';

/** Monta o Set-Cookie para gravar o token. */
function buildSetCookie(token: string, maxAgeSeconds: number): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (IS_PROD) parts.push('Secure');
  return parts.join('; ');
}

/** Monta o Set-Cookie para apagar o cookie. */
function buildClearCookie(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${IS_PROD ? '; Secure' : ''}`;
}

/** Extrai o token do cookie de sessão. */
function tokenFromCookie(req: VercelRequest): string | null {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === COOKIE_NAME) return rest.join('=') || null;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── POST: salva o token em cookie HttpOnly ──────────────────────────────
  if (req.method === 'POST') {
    // O token chega no header Authorization (enviado imediatamente após login/register)
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return res.status(400).json({ error: 'Token ausente' });

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const maxAge = 7 * 24 * 60 * 60; // 7 dias em segundos
    res.setHeader('Set-Cookie', buildSetCookie(token, maxAge));
    return res.status(200).json({ ok: true, sub: payload.sub });
  }

  // ── GET: restaura a sessão a partir do cookie ──────────────────────────
  if (req.method === 'GET') {
    const token = tokenFromCookie(req);
    if (!token) return res.status(401).json({ error: 'Sem sessão ativa' });

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      // Cookie expirado ou adulterado — limpa
      res.setHeader('Set-Cookie', buildClearCookie());
      return res.status(401).json({ error: 'Sessão expirada' });
    }

    // Verifica blacklist
    try {
      const blacklisted = await sql`
        SELECT 1 FROM token_blacklist
        WHERE token_jti = ${payload.sub + '_' + (payload.iat ?? 0)}
          AND expires_at > NOW()
      `;
      if (blacklisted.length > 0) {
        res.setHeader('Set-Cookie', buildClearCookie());
        return res.status(401).json({ error: 'Sessão encerrada' });
      }

      const rows = await sql`
        SELECT id, name, email, avatar FROM users WHERE id = ${payload.sub}
      `;
      if (rows.length === 0) {
        res.setHeader('Set-Cookie', buildClearCookie());
        return res.status(401).json({ error: 'Usuário não encontrado' });
      }

      return res.status(200).json({ user: rows[0], token });
    } catch (e: any) {
      console.error('[me:GET]', e.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  // ── DELETE: remove o cookie (logout) ───────────────────────────────────
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', buildClearCookie());
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método não permitido' });
}
