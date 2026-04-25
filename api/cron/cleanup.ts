import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { cleanupDatabase } from '../../lib/db-maintenance.js';
import { logError, logInfo, logWarn } from '../../lib/logger.js';

function isAuthorized(req: VercelRequest): boolean {
  const vercelCronHeader = req.headers['x-vercel-cron'];
  if (vercelCronHeader === '1') return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.authorization;
  return authHeader === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'Método não permitido' });

  if (!isAuthorized(req)) {
    logWarn('cron_cleanup_unauthorized');
    return res.status(401).json({ error: 'Não autorizado' });
  }

  try {
    const result = await cleanupDatabase(sql);
    logInfo('cron_cleanup_completed', result);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    logError('cron_cleanup_failed', error);
    return res.status(500).json({ error: 'Erro ao limpar dados expirados' });
  }
}
