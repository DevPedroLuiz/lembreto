import postgres from 'postgres';

import type { SqlClient } from './handlers/core.js';

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isLocalDatabaseUrl(databaseUrl: string) {
  return (
    databaseUrl.includes('sslmode=disable') ||
    databaseUrl.includes('localhost') ||
    databaseUrl.includes('127.0.0.1')
  );
}

function redactHost(host: string | null) {
  if (!host) return null;
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  return `${parts[0].slice(0, 8)}...${parts.slice(-2).join('.')}`;
}

function inferPoolMode(host: string | null, port: string | null) {
  if (!host) return 'unknown';
  if (host.includes('pooler.supabase.com')) {
    if (port === '6543') return 'supabase-transaction-pooler';
    if (port === '5432') return 'supabase-session-pooler';
    return 'supabase-pooler';
  }

  if (host.includes('supabase.co')) return 'supabase-direct';
  if (host.includes('neon.tech')) return 'neon';
  return 'unknown';
}

export function getDatabaseConnectionMetadata(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    return {
      configured: false,
      host: null,
      port: null,
      ssl: null,
      poolMode: 'unknown',
      provider: 'unknown',
      maxConnections: parsePositiveInteger(process.env.POSTGRES_MAX_CONNECTIONS, 1),
      connectTimeoutSeconds: parsePositiveInteger(process.env.PGCONNECT_TIMEOUT, 3),
      idleTimeoutSeconds: parsePositiveInteger(process.env.POSTGRES_IDLE_TIMEOUT, 20),
      statementTimeoutMs: parsePositiveInteger(process.env.POSTGRES_STATEMENT_TIMEOUT_MS, 3000),
      vercelRegion: process.env.VERCEL_REGION ?? process.env.AWS_REGION ?? null,
    };
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    parsed = null;
  }

  const host = parsed?.hostname ?? null;
  const port = parsed?.port || null;
  const poolMode = inferPoolMode(host, port);
  const provider = poolMode.includes('supabase')
    ? 'supabase'
    : poolMode === 'neon'
      ? 'neon'
      : 'unknown';

  return {
    configured: true,
    host: redactHost(host),
    port,
    ssl: isLocalDatabaseUrl(databaseUrl) ? 'disabled' : 'required',
    poolMode,
    provider,
    maxConnections: parsePositiveInteger(process.env.POSTGRES_MAX_CONNECTIONS, 1),
    connectTimeoutSeconds: parsePositiveInteger(process.env.PGCONNECT_TIMEOUT, 3),
    idleTimeoutSeconds: parsePositiveInteger(process.env.POSTGRES_IDLE_TIMEOUT, 20),
    statementTimeoutMs: parsePositiveInteger(process.env.POSTGRES_STATEMENT_TIMEOUT_MS, 3000),
    vercelRegion: process.env.VERCEL_REGION ?? process.env.AWS_REGION ?? null,
  };
}

export function createSqlClient(databaseUrl = process.env.DATABASE_URL): SqlClient {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL nao definida nas variaveis de ambiente.');
  }

  const metadata = getDatabaseConnectionMetadata(databaseUrl);
  const shouldDisableSsl = isLocalDatabaseUrl(databaseUrl);

  return postgres(databaseUrl, {
    ssl: shouldDisableSsl ? false : 'require',
    max: metadata.maxConnections,
    prepare: false,
    connect_timeout: metadata.connectTimeoutSeconds,
    idle_timeout: metadata.idleTimeoutSeconds,
    connection: {
      application_name: 'lembreto-api',
      statement_timeout: metadata.statementTimeoutMs,
      lock_timeout: metadata.statementTimeoutMs,
    },
  }) as unknown as SqlClient;
}
