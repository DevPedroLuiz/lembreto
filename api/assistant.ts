import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from './_db.js';
import { handleAssistantMessage } from '../lib/handlers/assistant.js';
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

  const result = action === 'message'
    ? await handleAssistantMessage({ sql, request })
    : {
      status: 404,
      body: { error: 'Rota do assistente nao encontrada' },
    };

  return sendHandlerResult(res, result);
}
