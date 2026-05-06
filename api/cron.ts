import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from './_db.js';
import { handleCleanupCron } from '../lib/handlers/cron.js';
import { handleNotificationsCron } from '../lib/handlers/notifications.js';
import { buildHandlerRequest, sendHandlerResult } from '../lib/handlers/core.js';

function resolveJob(req: VercelRequest): string | null {
  const value = req.query.job;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const job = resolveJob(req);
  const request = buildHandlerRequest(req);

  const result = await (async () => {
    switch (job) {
      case 'cleanup':
        return handleCleanupCron({ sql, request });
      case 'notifications':
        return handleNotificationsCron({ sql, request });
      default:
        return {
          status: 404,
          body: { error: 'Cron não encontrado' },
        };
    }
  })();

  return sendHandlerResult(res, result);
}
