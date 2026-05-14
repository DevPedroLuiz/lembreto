import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL nao definida para preparar o banco de teste.');
}

const schema = readFileSync('schema.sql', 'utf8');
const indexes = readFileSync('migrate_supabase_indexes.sql', 'utf8');
const shouldDisableSsl =
  databaseUrl.includes('sslmode=disable') ||
  databaseUrl.includes('localhost') ||
  databaseUrl.includes('127.0.0.1');

const sql = postgres(databaseUrl, {
  ssl: shouldDisableSsl ? false : 'require',
  max: 1,
  prepare: false,
});

try {
  await sql.unsafe(schema);
  await sql.unsafe(indexes);
  console.log('Test database schema ready.');
} finally {
  await sql.end();
}
