import postgres from 'postgres';

import type { SqlClient } from './handlers/core.js';

export function createSqlClient(databaseUrl = process.env.DATABASE_URL): SqlClient {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL nao definida nas variaveis de ambiente.');
  }

  return postgres(databaseUrl, {
    ssl: 'require',
    max: 1,
    prepare: false,
  }) as unknown as SqlClient;
}
