import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from './_db.js';
import {
  handleTaskById,
  handleTaskCalendarExport,
  handleTaskCalendarFeed,
  handleTaskCategoriesCollection,
  handleTaskHolidayLocationDetect,
  handleTaskHolidays,
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

  let result;

  if (action === 'metadata') {
    result = await handleTaskTaxonomy({ sql, request });
  } else if (action === 'calendar-ics') {
    result = await handleTaskCalendarExport({ sql, request });
  } else if (action === 'calendar-feed') {
    result = await handleTaskCalendarFeed({ sql, request });
  } else if (action === 'holidays') {
    result = await handleTaskHolidays({ sql, request });
  } else if (action === 'holidays-location') {
    result = await handleTaskHolidayLocationDetect({ sql, request });
  } else if (action === 'categories') {
    result = await handleTaskCategoriesCollection({ sql, request });
  } else if (action === 'tags') {
    result = await handleTaskTagsCollection({ sql, request });
  } else if (hasTaskId(req)) {
    result = await handleTaskById({ sql, request });
  } else {
    result = await handleTasksCollection({ sql, request });
  }

  return sendHandlerResult(res, result);
}
