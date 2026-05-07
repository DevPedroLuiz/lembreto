import { createSqlClient } from '../lib/db.js';
import { cleanupDatabase } from '../lib/db-maintenance.js';
import { logInfo, logError } from '../lib/logger.js';

const sql = createSqlClient();

async function cleanup() {
  const result = await cleanupDatabase(sql);
  logInfo('db_cleanup_completed', result);
}

cleanup().catch((error) => {
  logError('db_cleanup_failed', error);
  process.exitCode = 1;
});
