import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { handleNotificationMarkAllRead } from '../../lib/handlers/notifications.js';
import { buildHandlerRequest, sendHandlerResult } from '../../lib/handlers/core.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await handleNotificationMarkAllRead({
    sql,
    request: buildHandlerRequest(req),
  });

  return sendHandlerResult(res, result);
}
