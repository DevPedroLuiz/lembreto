import postgres from 'postgres';

import type { SqlClient } from './handlers/core.js';

export function createSqlClient(databaseUrl = process.env.DATABASE_URL): SqlClient {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL nao definida nas variaveis de ambiente.');
  }

  const shouldDisableSsl =
    databaseUrl.includes('sslmode=disable') ||
    databaseUrl.includes('localhost') ||
    databaseUrl.includes('127.0.0.1');

  return postgres(databaseUrl, {
    ssl: shouldDisableSsl ? false : 'require',
    max: 1,
    prepare: false,
  }) as unknown as SqlClient;
}
