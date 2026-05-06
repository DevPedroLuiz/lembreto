import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from './_db.js';
import {
  handleAuthGoogleCallback,
  handleAuthGoogleStart,
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe,
  handleAuthProfile,
  handleAuthRecover,
  handleAuthRegister,
  handleAuthResetPassword,
} from '../lib/handlers/auth.js';
import { buildHandlerRequest, sendHandlerResult } from '../lib/handlers/core.js';

function resolveAction(req: VercelRequest): string | null {
  const value = req.query.action;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = resolveAction(req);
  const request = buildHandlerRequest(req);

  const result = await (async () => {
    switch (action) {
      case 'google-start':
        return handleAuthGoogleStart({ sql, request });
      case 'google-callback':
        return handleAuthGoogleCallback({ sql, request });
      case 'register':
        return handleAuthRegister({ sql, request });
      case 'login':
        return handleAuthLogin({ sql, request });
      case 'logout':
        return handleAuthLogout({ sql, request });
      case 'me':
        return handleAuthMe({ sql, request });
      case 'recover':
        return handleAuthRecover({ sql, request });
      case 'reset-password':
        return handleAuthResetPassword({ sql, request });
      case 'profile':
        return handleAuthProfile({ sql, request });
      default:
        return {
          status: 404,
          body: { error: 'Rota de autenticacao nao encontrada' },
        };
    }
  })();

  return sendHandlerResult(res, result);
}
