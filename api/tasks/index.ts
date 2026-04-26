import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { handleTasksCollection } from '../../lib/handlers/tasks.js';
import { buildHandlerRequest, sendHandlerResult } from '../../lib/handlers/core.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await handleTasksCollection({
    sql,
    request: buildHandlerRequest(req),
  });

  return sendHandlerResult(res, result);
}
