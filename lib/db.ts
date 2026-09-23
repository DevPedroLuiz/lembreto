import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
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

type DatabaseUrlPurpose = 'runtime' | 'migration';

const runtimeDatabaseUrlEnvNames = [
  'DATABASE_URL',
  'SUPABASE_APP_DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_URL_PRISMA',
  'NEON_DATABASE_URL',
] as const;

const migrationDatabaseUrlEnvNames = [
  'SUPABASE_MIGRATION_DATABASE_URL',
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_URL_NO_SSL',
  'SUPABASE_APP_DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_URL_PRISMA',
  'NEON_DATABASE_URL',
] as const;

export function resolveDatabaseUrl(purpose: DatabaseUrlPurpose = 'runtime') {
  const candidates =
    purpose === 'migration' ? migrationDatabaseUrlEnvNames : runtimeDatabaseUrlEnvNames;

  for (const name of candidates) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  return undefined;
}

export function getDatabaseConnectionMetadata(databaseUrl = resolveDatabaseUrl()) {
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

function createMockSqlClient(): SqlClient {
  const usersById = new Map<string, any>();
  const usersByEmail = new Map<string, any>();
  const tasks = new Map<string, any>();
  const notes = new Map<string, any>();
  const notifications = new Map<string, any>();
  const sessions = new Map<string, any>();
  const categories = new Set<string>(['Trabalho', 'Pessoal', 'Estudos', 'Saúde', 'Finanças']);
  const tags = new Set<string>(['urgente', 'revisar', 'ideia']);

  // Pre-seed demo user so one-click login/testing works out of the box
  const demoSalt = bcrypt.genSaltSync(10);
  const demoHash = bcrypt.hashSync('demo123456', demoSalt);
  const demoUser = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Usuário Demo',
    email: 'demo@lembreto.app',
    password: demoHash,
    avatar: null,
    state_code: 'SP',
    city_name: 'São Paulo',
    holiday_region_code: 'SP-SAOPAULO',
    email_verified_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  usersById.set(demoUser.id, demoUser);
  usersByEmail.set(demoUser.email, demoUser);

  const mockSql = (async (strings: TemplateStringsArray, ...params: unknown[]) => {
    const rawSql = strings.join('?').trim();
    const query = rawSql.toLowerCase();

    // 1. Schema, migrations, infrastructure introspection
    if (
      query.includes('information_schema') ||
      query.includes('pg_catalog') ||
      query.includes('jsonb_to_recordset') ||
      query.startsWith('create table') ||
      query.startsWith('alter table') ||
      query.startsWith('create index') ||
      query.startsWith('create extension')
    ) {
      return [];
    }

    // 2. Organization queries
    if (query.includes('from organization_row') || query.includes('insert into organizations') || query.includes('from organizations')) {
      return [{
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Meu workspace',
        slug: 'personal-workspace',
        type: 'personal',
        role: 'owner',
        plan_code: 'free',
        planCode: 'free',
      }];
    }
    if (query.includes('organization_members') || query.includes('subscriptions')) {
      return [{
        organization_id: '00000000-0000-4000-8000-000000000002',
        role: 'owner',
        status: 'active',
        plan_code: 'free',
      }];
    }

    // 3. User queries
    if (query.includes('from users') || (query.startsWith('select') && query.includes('users'))) {
      if (query.startsWith('select')) {
        for (const p of params) {
          if (typeof p === 'string') {
            if (usersByEmail.has(p)) {
              const u = usersByEmail.get(p);
              return [{
                ...u,
                password_hash: u.password,
                stateCode: u.state_code,
                cityName: u.city_name,
                holidayRegionCode: u.holiday_region_code,
                emailVerifiedAt: u.email_verified_at,
              }];
            }
            if (usersById.has(p)) {
              const u = usersById.get(p);
              return [{
                ...u,
                password_hash: u.password,
                stateCode: u.state_code,
                cityName: u.city_name,
                holidayRegionCode: u.holiday_region_code,
                emailVerifiedAt: u.email_verified_at,
              }];
            }
          }
        }
        return [];
      }

      if (query.startsWith('update users')) {
        for (const p of params) {
          if (typeof p === 'string' && usersById.has(p)) {
            const u = usersById.get(p);
            return [u];
          }
        }
        return [];
      }
    }

    if (query.startsWith('insert into users')) {
      const id = crypto.randomUUID();
      const name = String(params[0] ?? 'Usuário');
      const email = String(params[1] ?? `user-${id}@lembreto.app`);
      const password = String(params[2] ?? '');
      const avatar = params[3] ? String(params[3]) : null;
      const state_code = params[4] ? String(params[4]) : null;
      const city_name = params[5] ? String(params[5]) : null;
      const holiday_region_code = params[6] ? String(params[6]) : null;

      const newUser = {
        id,
        name,
        email,
        password,
        avatar,
        state_code,
        city_name,
        holiday_region_code,
        email_verified_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      usersById.set(newUser.id, newUser);
      usersByEmail.set(newUser.email, newUser);
      return [{
        ...newUser,
        emailVerifiedAt: newUser.email_verified_at,
        stateCode: newUser.state_code,
        cityName: newUser.city_name,
        holidayRegionCode: newUser.holiday_region_code,
      }];
    }

    // 4. Auth sessions
    if (query.includes('auth_sessions')) {
      if (query.startsWith('insert')) {
        const jti = String(params[1] ?? crypto.randomUUID());
        sessions.set(jti, { jti, userId: params[0], created_at: new Date().toISOString() });
        return [];
      }
      return [{ count: '1' }];
    }

    // 5. Blacklist / rate limit
    if (query.includes('token_blacklist') || query.includes('auth_rate_limit')) {
      return [];
    }

    // 6. Plan limits count
    if (query.includes('count(*) as count from tasks')) {
      return [{ count: String(tasks.size) }];
    }
    if (query.includes('count(*) as total from tasks')) {
      return [{ total: String(tasks.size) }];
    }

    // 7. Tasks queries
    if (query.includes('tasks')) {
      if (query.startsWith('insert into tasks')) {
        const id = crypto.randomUUID();
        const newTask = {
          id,
          userId: params[0] || '00000000-0000-4000-8000-000000000001',
          user_id: params[0] || '00000000-0000-4000-8000-000000000001',
          organizationId: params[1] || '00000000-0000-4000-8000-000000000002',
          organization_id: params[1] || '00000000-0000-4000-8000-000000000002',
          clientMutationId: params[2] || null,
          client_mutation_id: params[2] || null,
          title: params[3] || 'Nova Tarefa',
          description: params[4] || '',
          dueDate: params[5] || null,
          due_date: params[5] || null,
          endDate: params[6] || null,
          end_date: params[6] || null,
          priority: params[7] || 'medium',
          category: params[8] || 'Geral',
          tags: Array.isArray(params[9]) ? params[9] : [],
          suppressHolidayNotifications: Boolean(params[10]),
          suppress_holiday_notifications: Boolean(params[10]),
          overdueReminderIntensity: params[11] || 'normal',
          overdue_reminder_intensity: params[11] || 'normal',
          alarmEnabled: Boolean(params[12]),
          alarm_enabled: Boolean(params[12]),
          preNoticeMinutes: params[13] || null,
          pre_notice_minutes: params[13] || null,
          reminderMode: 'timed',
          reminder_mode: 'timed',
          status: params[14] || 'pending',
          history: [],
          createdAt: new Date().toISOString(),
          created_at: new Date().toISOString(),
          deletedAt: null,
          deleted_at: null,
          completedAt: null,
          completed_at: null,
        };
        tasks.set(id, newTask);
        return [newTask];
      }

      if (query.startsWith('select')) {
        for (const p of params) {
          if (typeof p === 'string' && tasks.has(p)) {
            return [tasks.get(p)];
          }
        }
        return Array.from(tasks.values()).filter((t) => !t.deleted_at);
      }

      if (query.startsWith('update tasks')) {
        for (const p of params) {
          if (typeof p === 'string' && tasks.has(p)) {
            const task = tasks.get(p);
            return [task];
          }
        }
        return [];
      }

      if (query.startsWith('delete from tasks')) {
        for (const p of params) {
          if (typeof p === 'string' && tasks.has(p)) {
            tasks.delete(p);
          }
        }
        return [];
      }
    }

    // 8. Notes queries
    if (query.includes('notes')) {
      if (query.startsWith('insert into notes')) {
        const id = crypto.randomUUID();
        const newNote = {
          id,
          userId: params[0],
          user_id: params[0],
          organizationId: params[1],
          organization_id: params[1],
          taskId: params[2] || null,
          task_id: params[2] || null,
          title: params[3] || '',
          content: params[4] || '',
          priority: params[5] || 'medium',
          category: params[6] || 'Geral',
          tags: Array.isArray(params[7]) ? params[7] : [],
          mode: params[8] || 'temporary',
          expiresAt: params[9] || null,
          expires_at: params[9] || null,
          deletedAt: null,
          deleted_at: null,
          deleteAfter: null,
          delete_after: null,
          deletionReason: null,
          deletion_reason: null,
          expiredNotificationSentAt: null,
          expired_notification_sent_at: null,
          createdAt: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        notes.set(id, newNote);
        return [newNote];
      }
      if (query.startsWith('select')) {
        for (const p of params) {
          if (typeof p === 'string' && notes.has(p)) {
            return [notes.get(p)];
          }
        }
        return Array.from(notes.values()).filter((n) => !n.deleted_at);
      }
      if (query.startsWith('delete')) {
        for (const p of params) {
          if (typeof p === 'string' && notes.has(p)) {
            notes.delete(p);
          }
        }
        return [];
      }
    }

    // 9. Categories & tags taxonomy
    if (query.includes('user_categories') || query.includes('category_names')) {
      return Array.from(categories).map((name) => ({ name }));
    }
    if (query.includes('user_tags') || query.includes('tag_names')) {
      return Array.from(tags).map((name) => ({ name, usage_count: 1 }));
    }

    // 10. Notifications
    if (query.includes('notifications')) {
      if (query.startsWith('insert')) {
        const id = crypto.randomUUID();
        const notification = {
          id,
          userId: params[0],
          user_id: params[0],
          title: params[1] || 'Notificação',
          body: params[2] || '',
          read: false,
          createdAt: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        notifications.set(id, notification);
        return [notification];
      }
      return Array.from(notifications.values());
    }

    return [];
  }) as unknown as SqlClient;

  (mockSql as any).__isMock = true;
  mockSql.json = (val: unknown) => val;
  mockSql.begin = async <T>(callback: (sql: SqlClient) => Promise<T>): Promise<T> => {
    return callback(mockSql);
  };

  return mockSql;
}

export function createSqlClient(databaseUrl = resolveDatabaseUrl()): SqlClient {
  if (!databaseUrl) {
    console.warn('[AI Studio] DATABASE_URL não configurada — ativando armazenamento mock em memória.');
    return createMockSqlClient();
  }

  const metadata = getDatabaseConnectionMetadata(databaseUrl);
  const shouldDisableSsl = isLocalDatabaseUrl(databaseUrl);

  try {
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
  } catch (error) {
    console.warn('[AI Studio] Falha ao inicializar PostgreSQL — ativando armazenamento mock em memória.', error);
    return createMockSqlClient();
  }
}
