import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from './_db.js';
import {
  handleTaskById,
  handleTaskCategoriesCollection,
  handleTaskTagsCollection,
  handleTaskTaxonomy,
  handleTasksCollection,
} from '../lib/handlers/tasks.js';
import { buildHandlerRequest, sendHandlerResult } from '../lib/handlers/core.js';

function hasTaskId(req: VercelRequest): boolean {
  const value = req.query.id;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim().length > 0;
  return false;
}

function resolveAction(req: VercelRequest): string | null {
  const value = req.query.action;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const request = buildHandlerRequest(req);
  const action = resolveAction(req);

  const result = action === 'metadata'
    ? await handleTaskTaxonomy({ sql, request })
    : action === 'categories'
      ? await handleTaskCategoriesCollection({ sql, request })
      : action === 'tags'
        ? await handleTaskTagsCollection({ sql, request })
        : hasTaskId(req)
          ? await handleTaskById({ sql, request })
          : await handleTasksCollection({ sql, request });

  return sendHandlerResult(res, result);
}
