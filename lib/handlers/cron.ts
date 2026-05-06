import { cleanupDatabase } from '../db-maintenance.js';
import { logError, logInfo, logWarn } from '../logger.js';
import {
  type HandlerContext,
  type HandlerResult,
  getRequestMeta,
  json,
  methodNotAllowed,
} from './core.js';

function isAuthorized(context: HandlerContext): boolean {
  const vercelCronHeader = context.request.headers['x-vercel-cron'];
  if (vercelCronHeader === '1') return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = context.request.headers.authorization;
  return authHeader === `Bearer ${secret}`;
}

export async function handleCleanupCron(context: HandlerContext): Promise<HandlerResult> {
  if (context.request.method !== 'GET') return methodNotAllowed();

  if (!isAuthorized(context)) {
    logWarn('cron_cleanup_unauthorized', getRequestMeta(context.request));
    return json(401, { error: 'Não autorizado' });
  }

  try {
    const result = await cleanupDatabase(context.sql);
    logInfo('cron_cleanup_completed', getRequestMeta(context.request, result));
    return json(200, { ok: true, ...result });
  } catch (error) {
    logError('cron_cleanup_failed', error, getRequestMeta(context.request));
    return json(500, { error: 'Erro ao limpar dados expirados' });
  }
}
