import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import postgres from 'postgres';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const localEnvPath = join(rootDir, '.env.local');
if (existsSync(localEnvPath)) {
  config({ path: localEnvPath });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations.');
}

const migrationsDir = join(rootDir, 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (migrationFiles.length === 0) {
  console.log('No migration files found.');
  process.exit(0);
}

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
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const appliedRows = await sql`SELECT version FROM schema_migrations`;
  const applied = new Set(appliedRows.map((row) => String(row.version)));

  for (const file of migrationFiles) {
    const version = basename(file, '.sql');
    if (applied.has(version)) {
      console.log(`Skipping migration ${version}`);
      continue;
    }

    const migrationSql = readFileSync(join(migrationsDir, file), 'utf8');
    console.log(`Applying migration ${version}`);

    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL lock_timeout = '5s'`;
      await transaction`SET LOCAL statement_timeout = '60s'`;
      await transaction.unsafe(migrationSql);
      await transaction`
        INSERT INTO schema_migrations (version)
        VALUES (${version})
      `;
    });
  }

  console.log('Migrations complete.');
} finally {
  await sql.end();
}
