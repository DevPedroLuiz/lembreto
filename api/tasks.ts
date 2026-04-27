import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from './_db.js';
import { handleTaskById, handleTasksCollection } from '../lib/handlers/tasks.js';
import { buildHandlerRequest, sendHandlerResult } from '../lib/handlers/core.js';

function hasTaskId(req: VercelRequest): boolean {
  const value = req.query.id;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim().length > 0;
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const request = buildHandlerRequest(req);
  const result = hasTaskId(req)
    ? await handleTaskById({ sql, request })
    : await handleTasksCollection({ sql, request });

  return sendHandlerResult(res, result);
}
