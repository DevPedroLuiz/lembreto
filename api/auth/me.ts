import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import {
  getAuthFailureResponse,
  requireAuthFromAuthorizationHeader,
  requireAuthFromToken,
} from '../../lib/auth.js';
import {
  buildSessionCookie,
  clearSessionCookie,
  getSessionTokenFromCookieHeader,
} from '../../lib/session.js';
import { isTrustedRequestOrigin } from '../../lib/csrf.js';
import { logError, logWarn } from '../../lib/logger.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    if (!isTrustedRequestOrigin(req.headers)) {
      logWarn('auth_me_post_csrf_blocked', { host: req.headers.host });
      return res.status(403).json({ error: 'Origem não permitida' });
    }

    try {
      const { payload, token } = await requireAuthFromAuthorizationHeader(sql, req.headers.authorization);
      res.setHeader('Set-Cookie', buildSessionCookie(token, 7 * 24 * 60 * 60));
      return res.status(200).json({ ok: true, sub: payload.sub });
    } catch (error) {
      const authFailure = getAuthFailureResponse(error);
      if (authFailure) return res.status(authFailure.status).json({ error: authFailure.error });
      logError('auth_me_post_failed', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  if (req.method === 'GET') {
    const token = getSessionTokenFromCookieHeader(req.headers.cookie);
    if (!token) return res.status(401).json({ error: 'Sem sessão ativa' });

    try {
      const { user } = await requireAuthFromToken(sql, token);
      return res.status(200).json({ user, token });
    } catch (error) {
      const authFailure = getAuthFailureResponse(error);
      if (authFailure) {
        res.setHeader('Set-Cookie', clearSessionCookie());
        return res.status(authFailure.status).json({ error: authFailure.error });
      }
      logError('auth_me_get_failed', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  if (req.method === 'DELETE') {
    if (!isTrustedRequestOrigin(req.headers)) {
      logWarn('auth_me_delete_csrf_blocked', { host: req.headers.host });
      return res.status(403).json({ error: 'Origem não permitida' });
    }

    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método não permitido' });
}
