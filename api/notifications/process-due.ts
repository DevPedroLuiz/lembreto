import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { buildHandlerRequest, sendHandlerResult } from '../../lib/handlers/core.js';
import { handleNotificationProcessDue } from '../../lib/handlers/notifications.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await handleNotificationProcessDue({
    sql,
    request: buildHandlerRequest(req),
  });

  return sendHandlerResult(res, result);
}
