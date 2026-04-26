import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { handleCleanupCron } from '../../lib/handlers/cron.js';
import { buildHandlerRequest, sendHandlerResult } from '../../lib/handlers/core.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await handleCleanupCron({
    sql,
    request: buildHandlerRequest(req),
  });

  return sendHandlerResult(res, result);
}
