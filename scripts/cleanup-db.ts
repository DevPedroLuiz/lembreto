import { neon } from '@neondatabase/serverless';
import { cleanupDatabase } from '../lib/db-maintenance.js';
import { logInfo, logError } from '../lib/logger.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL nao definida.');
}

const sql = neon(process.env.DATABASE_URL);

async function cleanup() {
  const result = await cleanupDatabase(sql);
  logInfo('db_cleanup_completed', result);
}

cleanup().catch((error) => {
  logError('db_cleanup_failed', error);
  process.exitCode = 1;
});
