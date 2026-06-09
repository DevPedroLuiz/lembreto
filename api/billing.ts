import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from './_db.js';
import { handleBilling } from '../lib/handlers/billing.js';
import { buildHandlerRequest, handleCorsPreflight, sendHandlerResult } from '../lib/handlers/core.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const request = buildHandlerRequest(req);
  const preflight = handleCorsPreflight(request);
  if (preflight) return sendHandlerResult(res, preflight, request);

  const result = await handleBilling({ sql, request });
  return sendHandlerResult(res, result, request);
}
