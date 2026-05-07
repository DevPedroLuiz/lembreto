import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from './_db.js';
import {
  handleCalendarConnectCallback,
  handleCalendarConnectStart,
  handleCalendarDisconnect,
  handleCalendarIntegrations,
  handleCalendarIntegrationSettings,
  handleCalendarTaskSync,
} from '../lib/handlers/calendar.js';
import { buildHandlerRequest, sendHandlerResult } from '../lib/handlers/core.js';

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

  if (action === 'connect') {
    result = await handleCalendarConnectStart({ sql, request });
  } else if (action === 'callback') {
    result = await handleCalendarConnectCallback({ sql, request });
  } else if (action === 'disconnect' || (action === 'settings' && req.method === 'DELETE')) {
    result = await handleCalendarDisconnect({ sql, request });
  } else if (action === 'settings') {
    result = await handleCalendarIntegrationSettings({ sql, request });
  } else if (action === 'sync-task') {
    result = await handleCalendarTaskSync({ sql, request });
  } else {
    result = await handleCalendarIntegrations({ sql, request });
  }

  return sendHandlerResult(res, result);
}
