import crypto from 'node:crypto';
import type { SafeUser } from '../auth.js';
import type { SqlClient } from '../handlers/core.js';
import { signCalendarOAuthState, verifyCalendarOAuthState } from '../jwt.js';
import { buildCalendarEventInput, LEMBRETO_TIME_ZONE } from './eventPayload.js';
import { decryptCalendarToken, encryptCalendarToken } from './crypto.js';
import { syncTaskNotificationSchedules } from '../notification-schedules.js';
import { googleCalendarClient, buildGoogleCalendarAuthorizationUrl } from './googleCalendar.js';
import { outlookCalendarClient, buildOutlookCalendarAuthorizationUrl } from './outlookCalendar.js';
import type {
  CalendarIntegration,
  CalendarProvider,
  CalendarProviderClient,
  CalendarTaskForSync,
  CalendarTokenSet,
  ExternalCalendarEvent,
  PublicCalendarIntegration,
} from './types.js';

const PROVIDER_LABELS: Record<CalendarProvider, string> = {
  google: 'Google Calendar',
  outlook: 'Outlook Calendar',
};

const PROVIDER_CLIENTS: Record<CalendarProvider, CalendarProviderClient> = {
  google: googleCalendarClient,
  outlook: outlookCalendarClient,
};

const ALL_PROVIDERS: CalendarProvider[] = ['google', 'outlook'];

let ensureCalendarSchemaPromise: Promise<void> | null = null;

function getCalendarSyncWindowStart(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LEMBRETO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    const fallback = new Date(now);
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }

  return new Date(`${year}-${month}-${day}T00:00:00-03:00`);
}

function buildDuplicateKey(input: { title: string; dueDate: string | null }): string | null {
  if (!input.dueDate) return null;
  const dueDate = new Date(input.dueDate);
  if (Number.isNaN(dueDate.getTime())) return null;

  return [
    input.title.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR'),
    dueDate.toISOString(),
  ].join('|');
}

export async function ensureCalendarIntegrationSchema(sql: SqlClient) {
  if (!ensureCalendarSchemaPromise) {
    ensureCalendarSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS calendar_integrations (
          id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider                TEXT        NOT NULL CHECK (provider IN ('google', 'outlook')),
          access_token_encrypted  TEXT        NOT NULL,
          refresh_token_encrypted TEXT        NOT NULL,
          expires_at              TIMESTAMPTZ,
          calendar_id             TEXT        NOT NULL DEFAULT 'primary',
          sync_enabled            BOOLEAN     NOT NULL DEFAULT TRUE,
          last_error              TEXT,
          created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_integrations_user_provider
        ON calendar_integrations(user_id, provider)
      `;
      await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_calendar_provider TEXT CHECK (external_calendar_provider IN ('google', 'outlook'))`;
      await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_calendar_event_id TEXT`;
      await sql`
        ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_calendar_sync_status TEXT NOT NULL DEFAULT 'idle'
        CHECK (external_calendar_sync_status IN ('idle', 'synced', 'failed'))
      `;
      await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_calendar_last_error TEXT`;
      await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_calendar_synced_at TIMESTAMPTZ`;
      await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_tasks_external_calendar
        ON tasks(user_id, external_calendar_provider, external_calendar_event_id)
        WHERE external_calendar_event_id IS NOT NULL
      `;
    })();
  }

  await ensureCalendarSchemaPromise;
}

function normalizeIntegration(row: Record<string, unknown>): CalendarIntegration {
  return {
    id: String(row.id),
    userId: String(row.userId),
    provider: String(row.provider) as CalendarProvider,
    accessTokenEncrypted: String(row.accessTokenEncrypted),
    refreshTokenEncrypted: String(row.refreshTokenEncrypted),
    expiresAt: row.expiresAt ? new Date(String(row.expiresAt)).toISOString() : null,
    calendarId: String(row.calendarId ?? 'primary'),
    syncEnabled: Boolean(row.syncEnabled),
    lastError: typeof row.lastError === 'string' ? row.lastError : null,
    createdAt: new Date(String(row.createdAt)).toISOString(),
    updatedAt: new Date(String(row.updatedAt)).toISOString(),
  };
}

export function toPublicIntegrations(rows: CalendarIntegration[]): PublicCalendarIntegration[] {
  const byProvider = new Map(rows.map((row) => [row.provider, row]));

  return ALL_PROVIDERS.map((provider) => {
    const integration = byProvider.get(provider);
    return {
      provider,
      connected: Boolean(integration),
      syncEnabled: integration?.syncEnabled ?? false,
      calendarId: integration?.calendarId ?? null,
      lastError: integration?.lastError ?? null,
      updatedAt: integration?.updatedAt ?? null,
    };
  });
}

export async function listCalendarIntegrations(sql: SqlClient, userId: string): Promise<CalendarIntegration[]> {
  await ensureCalendarIntegrationSchema(sql);
  const rows = await sql`
    SELECT
      id,
      user_id AS "userId",
      provider,
      access_token_encrypted AS "accessTokenEncrypted",
      refresh_token_encrypted AS "refreshTokenEncrypted",
      expires_at AS "expiresAt",
      calendar_id AS "calendarId",
      sync_enabled AS "syncEnabled",
      last_error AS "lastError",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM calendar_integrations
    WHERE user_id = ${userId}
    ORDER BY provider ASC
  `;

  return rows.map(normalizeIntegration);
}

export async function getCalendarIntegration(
  sql: SqlClient,
  userId: string,
  provider: CalendarProvider,
): Promise<CalendarIntegration | null> {
  const rows = await listCalendarIntegrations(sql, userId);
  return rows.find((row) => row.provider === provider) ?? null;
}

export async function upsertCalendarIntegration(input: {
  sql: SqlClient;
  userId: string;
  provider: CalendarProvider;
  tokenSet: CalendarTokenSet;
  calendarId?: string;
}) {
  await ensureCalendarIntegrationSchema(input.sql);
  await input.sql`
    INSERT INTO calendar_integrations (
      user_id,
      provider,
      access_token_encrypted,
      refresh_token_encrypted,
      expires_at,
      calendar_id,
      sync_enabled,
      last_error,
      updated_at
    )
    VALUES (
      ${input.userId},
      ${input.provider},
      ${encryptCalendarToken(input.tokenSet.accessToken)},
      ${encryptCalendarToken(input.tokenSet.refreshToken)},
      ${input.tokenSet.expiresAt},
      ${input.calendarId ?? 'primary'},
      TRUE,
      ${null},
      NOW()
    )
    ON CONFLICT (user_id, provider)
    DO UPDATE SET
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      expires_at = EXCLUDED.expires_at,
      calendar_id = EXCLUDED.calendar_id,
      sync_enabled = TRUE,
      last_error = NULL,
      updated_at = NOW()
  `;
}

export async function updateCalendarIntegrationSyncEnabled(input: {
  sql: SqlClient;
  userId: string;
  provider: CalendarProvider;
  syncEnabled: boolean;
}) {
  await ensureCalendarIntegrationSchema(input.sql);
  await input.sql`
    UPDATE calendar_integrations
    SET sync_enabled = ${input.syncEnabled}, updated_at = NOW()
    WHERE user_id = ${input.userId} AND provider = ${input.provider}
  `;
}

export async function disconnectCalendarIntegration(input: {
  sql: SqlClient;
  userId: string;
  provider: CalendarProvider;
}) {
  await ensureCalendarIntegrationSchema(input.sql);
  await input.sql`
    DELETE FROM calendar_integrations
    WHERE user_id = ${input.userId} AND provider = ${input.provider}
  `;
  await input.sql`
    UPDATE tasks
    SET
      external_calendar_provider = NULL,
      external_calendar_event_id = NULL,
      external_calendar_sync_status = 'idle',
      external_calendar_last_error = NULL,
      external_calendar_synced_at = NULL
    WHERE user_id = ${input.userId}
      AND external_calendar_provider = ${input.provider}
  `;
}

export function buildCalendarAuthorizationUrl(input: {
  provider: CalendarProvider;
  user: SafeUser;
  redirectUri: string;
}): string {
  const state = signCalendarOAuthState({
    sub: input.user.id,
    provider: input.provider,
    nonce: crypto.randomBytes(16).toString('hex'),
  });

  if (input.provider === 'google') {
    return buildGoogleCalendarAuthorizationUrl({ state, redirectUri: input.redirectUri });
  }

  return buildOutlookCalendarAuthorizationUrl({ state, redirectUri: input.redirectUri });
}

export async function connectCalendarFromOAuthCallback(input: {
  sql: SqlClient;
  state: string;
  code: string;
  redirectUri: string;
}): Promise<CalendarProvider> {
  const state = verifyCalendarOAuthState(input.state);
  const client = PROVIDER_CLIENTS[state.provider];
  const tokenSet = await client.exchangeCode(input.code, input.redirectUri);
  await upsertCalendarIntegration({
    sql: input.sql,
    userId: state.sub,
    provider: state.provider,
    tokenSet,
  });
  return state.provider;
}

async function saveRefreshedTokens(input: {
  sql: SqlClient;
  integration: CalendarIntegration;
  tokenSet: CalendarTokenSet;
}) {
  await input.sql`
    UPDATE calendar_integrations
    SET
      access_token_encrypted = ${encryptCalendarToken(input.tokenSet.accessToken)},
      refresh_token_encrypted = ${encryptCalendarToken(input.tokenSet.refreshToken)},
      expires_at = ${input.tokenSet.expiresAt},
      updated_at = NOW(),
      last_error = NULL
    WHERE id = ${input.integration.id}
  `;
}

async function getValidAccessToken(sql: SqlClient, integration: CalendarIntegration): Promise<string> {
  const expiresAt = integration.expiresAt ? new Date(integration.expiresAt) : null;
  const shouldRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 2 * 60 * 1000;
  if (!shouldRefresh) {
    return decryptCalendarToken(integration.accessTokenEncrypted);
  }

  const refreshToken = decryptCalendarToken(integration.refreshTokenEncrypted);
  const tokenSet = await PROVIDER_CLIENTS[integration.provider].refreshTokens(refreshToken);
  await saveRefreshedTokens({ sql, integration, tokenSet });
  return tokenSet.accessToken;
}

function sanitizeSyncError(error: unknown, provider: CalendarProvider): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!message || /token|secret|authorization/i.test(message)) {
    return `Falha ao sincronizar com ${PROVIDER_LABELS[provider]}. Reconecte o calendário e tente novamente.`;
  }

  return message.slice(0, 500);
}

async function markTaskCalendarSync(input: {
  sql: SqlClient;
  userId: string;
  taskId: string;
  provider: CalendarProvider | null;
  eventId: string | null;
  status: 'idle' | 'synced' | 'failed';
  error: string | null;
}) {
  await input.sql`
    UPDATE tasks
    SET
      external_calendar_provider = ${input.provider},
      external_calendar_event_id = ${input.eventId},
      external_calendar_sync_status = ${input.status},
      external_calendar_last_error = ${input.error},
      external_calendar_synced_at = ${input.status === 'synced' ? new Date() : null}
    WHERE id = ${input.taskId} AND user_id = ${input.userId}
  `;
}

async function markIntegrationError(sql: SqlClient, integration: CalendarIntegration, error: string | null) {
  await sql`
    UPDATE calendar_integrations
    SET last_error = ${error}, updated_at = NOW()
    WHERE id = ${integration.id}
  `;
}

export async function getTaskForCalendarSync(
  sql: SqlClient,
  userId: string,
  taskId: string,
): Promise<CalendarTaskForSync | null> {
  await ensureCalendarIntegrationSchema(sql);
  const rows = await sql`
    SELECT
      id,
      user_id AS "userId",
      title,
      description,
      due_date AS "dueDate",
      end_date AS "endDate",
      priority,
      category,
      tags,
      status,
      external_calendar_provider AS "externalCalendarProvider",
      external_calendar_event_id AS "externalCalendarEventId",
      external_calendar_sync_status AS "externalCalendarSyncStatus",
      external_calendar_last_error AS "externalCalendarLastError",
      external_calendar_synced_at AS "externalCalendarSyncedAt"
    FROM tasks
    WHERE id = ${taskId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    userId: String(row.userId),
    title: String(row.title),
    description: String(row.description ?? ''),
    dueDate: row.dueDate ? new Date(String(row.dueDate)).toISOString() : null,
    endDate: row.endDate ? new Date(String(row.endDate)).toISOString() : null,
    priority: String(row.priority) as CalendarTaskForSync['priority'],
    category: String(row.category ?? 'Geral'),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    status: String(row.status) as CalendarTaskForSync['status'],
    externalCalendarProvider: row.externalCalendarProvider ? String(row.externalCalendarProvider) as CalendarProvider : null,
    externalCalendarEventId: typeof row.externalCalendarEventId === 'string' ? row.externalCalendarEventId : null,
    externalCalendarSyncStatus: String(row.externalCalendarSyncStatus ?? 'idle') as CalendarTaskForSync['externalCalendarSyncStatus'],
    externalCalendarLastError: typeof row.externalCalendarLastError === 'string' ? row.externalCalendarLastError : null,
    externalCalendarSyncedAt: row.externalCalendarSyncedAt ? new Date(String(row.externalCalendarSyncedAt)).toISOString() : null,
  };
}

export async function syncTaskToExternalCalendar(input: {
  sql: SqlClient;
  userId: string;
  taskId: string;
  provider?: CalendarProvider;
  force?: boolean;
}): Promise<{ ok: boolean; provider: CalendarProvider | null; error?: string }> {
  const task = await getTaskForCalendarSync(input.sql, input.userId, input.taskId);
  if (!task) return { ok: false, provider: null, error: 'Lembrete não encontrado' };

  const eventInput = buildCalendarEventInput(task);
  if (!eventInput || task.status !== 'pending') {
    await removeTaskFromExternalCalendar({
      sql: input.sql,
      userId: input.userId,
      task,
      clearLocalState: true,
    });
    return { ok: true, provider: null };
  }

  const integrations = await listCalendarIntegrations(input.sql, input.userId);
  const integration = input.provider
    ? integrations.find((item) => item.provider === input.provider)
    : (
        task.externalCalendarProvider
          ? integrations.find((item) => item.provider === task.externalCalendarProvider)
          : integrations.find((item) => item.syncEnabled)
      );

  if (!integration || (!integration.syncEnabled && !input.force)) {
    if (!task.externalCalendarEventId) {
      await markTaskCalendarSync({
        sql: input.sql,
        userId: input.userId,
        taskId: task.id,
        provider: null,
        eventId: null,
        status: 'idle',
        error: null,
      });
    }
    return { ok: true, provider: null };
  }

  try {
    const accessToken = await getValidAccessToken(input.sql, integration);
    const client = PROVIDER_CLIENTS[integration.provider];
    const eventId = task.externalCalendarEventId && task.externalCalendarProvider === integration.provider
      ? await client.updateEvent(accessToken, integration.calendarId, task.externalCalendarEventId, eventInput)
      : await client.createEvent(accessToken, integration.calendarId, eventInput);

    await markTaskCalendarSync({
      sql: input.sql,
      userId: input.userId,
      taskId: task.id,
      provider: integration.provider,
      eventId,
      status: 'synced',
      error: null,
    });
    await markIntegrationError(input.sql, integration, null);
    return { ok: true, provider: integration.provider };
  } catch (error) {
    const message = sanitizeSyncError(error, integration.provider);
    await markTaskCalendarSync({
      sql: input.sql,
      userId: input.userId,
      taskId: task.id,
      provider: integration.provider,
      eventId: task.externalCalendarEventId,
      status: 'failed',
      error: message,
    });
    await markIntegrationError(input.sql, integration, message);
    return { ok: false, provider: integration.provider, error: message };
  }
}

async function listSyncableTaskIds(sql: SqlClient, userId: string): Promise<string[]> {
  await ensureCalendarIntegrationSchema(sql);
  const rows = await sql`
    SELECT id
    FROM tasks
    WHERE user_id = ${userId}
      AND due_date IS NOT NULL
      AND deleted_at IS NULL
      AND status <> 'cancelled'
    ORDER BY created_at ASC
  `;

  return rows.map((row) => String(row.id));
}

async function cleanupDuplicateLocalTasks(input: {
  sql: SqlClient;
  userId: string;
  provider: CalendarProvider;
}): Promise<{ removed: number; errors: string[] }> {
  await ensureCalendarIntegrationSchema(input.sql);

  const rows = await input.sql`
    SELECT
      id,
      title,
      due_date AS "dueDate",
      external_calendar_provider AS "externalCalendarProvider",
      external_calendar_event_id AS "externalCalendarEventId",
      created_at AS "createdAt"
    FROM tasks
    WHERE user_id = ${input.userId}
      AND due_date IS NOT NULL
      AND deleted_at IS NULL
      AND status <> 'cancelled'
    ORDER BY created_at ASC
  `;

  const groups = new Map<string, Array<{
    id: string;
    title: string;
    dueDate: string | null;
    externalCalendarProvider: CalendarProvider | null;
    externalCalendarEventId: string | null;
    createdAt: string;
  }>>();

  for (const row of rows) {
    const item = {
      id: String(row.id),
      title: String(row.title ?? ''),
      dueDate: row.dueDate ? new Date(String(row.dueDate)).toISOString() : null,
      externalCalendarProvider: row.externalCalendarProvider
        ? String(row.externalCalendarProvider) as CalendarProvider
        : null,
      externalCalendarEventId: typeof row.externalCalendarEventId === 'string'
        ? row.externalCalendarEventId
        : null,
      createdAt: row.createdAt ? new Date(String(row.createdAt)).toISOString() : '',
    };
    const key = buildDuplicateKey(item);
    if (!key) continue;

    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const errors: string[] = [];
  let removed = 0;

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const sorted = [...group].sort((left, right) => {
      const leftHasProviderEvent = left.externalCalendarProvider === input.provider && left.externalCalendarEventId ? 0 : 1;
      const rightHasProviderEvent = right.externalCalendarProvider === input.provider && right.externalCalendarEventId ? 0 : 1;
      if (leftHasProviderEvent !== rightHasProviderEvent) return leftHasProviderEvent - rightHasProviderEvent;
      return left.createdAt.localeCompare(right.createdAt);
    });
    const keeper = sorted[0];
    const duplicates = sorted.slice(1);

    for (const duplicate of duplicates) {
      const task = await getTaskForCalendarSync(input.sql, input.userId, duplicate.id);
      if (task?.externalCalendarProvider && task.externalCalendarEventId) {
        const removedExternal = await removeTaskFromExternalCalendar({
          sql: input.sql,
          userId: input.userId,
          task,
          clearLocalState: false,
        });

        if (!removedExternal.ok) {
          errors.push(removedExternal.error ?? `Falha ao remover duplicata externa do lembrete ${duplicate.id}.`);
          continue;
        }
      }

      await input.sql`
        UPDATE tasks
        SET
          status = 'cancelled',
          deleted_at = COALESCE(deleted_at, NOW())
        WHERE id = ${duplicate.id}
          AND user_id = ${input.userId}
          AND id <> ${keeper.id}
      `;
      removed += 1;
    }
  }

  return { removed, errors };
}

async function externalEventAlreadyImported(input: {
  sql: SqlClient;
  userId: string;
  provider: CalendarProvider;
  eventId: string;
}): Promise<boolean> {
  const rows = await input.sql`
    SELECT 1
    FROM tasks
    WHERE user_id = ${input.userId}
      AND external_calendar_provider = ${input.provider}
      AND external_calendar_event_id = ${input.eventId}
    LIMIT 1
  `;

  return rows.length > 0;
}

async function findMatchingTaskForExternalEvent(input: {
  sql: SqlClient;
  userId: string;
  provider: CalendarProvider;
  event: ExternalCalendarEvent;
}): Promise<{ id: string; externalCalendarEventId: string | null } | null> {
  const eventKey = buildDuplicateKey({ title: input.event.title, dueDate: input.event.dueDate });
  if (!eventKey) return null;

  const rows = await input.sql`
    SELECT
      id,
      title,
      due_date AS "dueDate",
      external_calendar_provider AS "externalCalendarProvider",
      external_calendar_event_id AS "externalCalendarEventId",
      created_at AS "createdAt"
    FROM tasks
    WHERE user_id = ${input.userId}
      AND due_date IS NOT NULL
      AND deleted_at IS NULL
      AND status <> 'cancelled'
    ORDER BY created_at ASC
  `;

  for (const row of rows) {
    const taskKey = buildDuplicateKey({
      title: String(row.title ?? ''),
      dueDate: row.dueDate ? new Date(String(row.dueDate)).toISOString() : null,
    });
    if (taskKey !== eventKey) continue;

    const taskProvider = row.externalCalendarProvider
      ? String(row.externalCalendarProvider) as CalendarProvider
      : null;
    const eventId = typeof row.externalCalendarEventId === 'string'
      ? row.externalCalendarEventId
      : null;
    if (taskProvider === input.provider && eventId === input.event.id) return null;

    return {
      id: String(row.id),
      externalCalendarEventId: eventId,
    };
  }

  return null;
}

async function linkExternalEventToExistingTask(input: {
  sql: SqlClient;
  userId: string;
  provider: CalendarProvider;
  taskId: string;
  eventId: string;
}) {
  await input.sql`
    UPDATE tasks
    SET
      external_calendar_provider = ${input.provider},
      external_calendar_event_id = ${input.eventId},
      external_calendar_sync_status = 'synced',
      external_calendar_last_error = NULL,
      external_calendar_synced_at = NOW()
    WHERE id = ${input.taskId}
      AND user_id = ${input.userId}
      AND deleted_at IS NULL
  `;
}

function buildImportedHistory(provider: CalendarProvider, eventId: string) {
  return [{
    id: crypto.randomUUID(),
    action: 'created',
    title: 'Evento importado',
    description: `Criado a partir de um evento do ${PROVIDER_LABELS[provider]}.`,
    createdAt: new Date().toISOString(),
    details: [
      `Evento externo: ${eventId}.`,
      'Sincronização em lote.',
    ],
  }];
}

async function importExternalCalendarEvent(input: {
  sql: SqlClient;
  userId: string;
  provider: CalendarProvider;
  event: ExternalCalendarEvent;
}): Promise<'created' | 'linked' | 'skipped'> {
  if (await externalEventAlreadyImported({
    sql: input.sql,
    userId: input.userId,
    provider: input.provider,
    eventId: input.event.id,
  })) {
    return 'skipped';
  }

  const matchingTask = await findMatchingTaskForExternalEvent(input);
  if (matchingTask) {
    await linkExternalEventToExistingTask({
      sql: input.sql,
      userId: input.userId,
      provider: input.provider,
      taskId: matchingTask.id,
      eventId: input.event.id,
    });
    return 'linked';
  }

  const inserted = await input.sql`
    INSERT INTO tasks (
      user_id,
      title,
      description,
      due_date,
      priority,
      category,
      tags,
      status,
      history,
      external_calendar_provider,
      external_calendar_event_id,
      external_calendar_sync_status,
      external_calendar_last_error,
      external_calendar_synced_at
    )
    VALUES (
      ${input.userId},
      ${input.event.title},
      ${input.event.description},
      ${input.event.dueDate},
      ${'medium'},
      ${'Agenda externa'},
      ${[input.provider === 'google' ? 'Google Calendar' : 'Outlook Calendar']},
      ${'pending'},
      ${input.sql.json ? input.sql.json(buildImportedHistory(input.provider, input.event.id)) : JSON.stringify(buildImportedHistory(input.provider, input.event.id))}::jsonb,
      ${input.provider},
      ${input.event.id},
      ${'synced'},
      ${null},
      NOW()
    )
    RETURNING id
  `;
  if (inserted[0]?.id) {
    await syncTaskNotificationSchedules(input.sql, input.userId, String(inserted[0].id));
  }

  return 'created';
}

export async function syncAllCalendarReminders(input: {
  sql: SqlClient;
  userId: string;
  provider: CalendarProvider;
}): Promise<{
  provider: CalendarProvider;
  pushed: number;
  imported: number;
  skipped: number;
  deduplicated: number;
  failed: number;
  errors: string[];
}> {
  const integration = await getCalendarIntegration(input.sql, input.userId, input.provider);
  if (!integration) {
    return {
      provider: input.provider,
      pushed: 0,
      imported: 0,
      skipped: 0,
      deduplicated: 0,
      failed: 1,
      errors: [`Conecte o ${PROVIDER_LABELS[input.provider]} antes de sincronizar.`],
    };
  }

  const errors: string[] = [];
  let pushed = 0;
  let skipped = 0;
  let failed = 0;
  let imported = 0;
  let deduplicated = 0;
  const syncWindowStart = getCalendarSyncWindowStart();

  const duplicateCleanup = await cleanupDuplicateLocalTasks({
    sql: input.sql,
    userId: input.userId,
    provider: input.provider,
  });
  deduplicated += duplicateCleanup.removed;
  if (duplicateCleanup.errors.length > 0) {
    failed += duplicateCleanup.errors.length;
    errors.push(...duplicateCleanup.errors);
  }

  const taskIds = await listSyncableTaskIds(input.sql, input.userId);
  for (const taskId of taskIds) {
    const result = await syncTaskToExternalCalendar({
      sql: input.sql,
      userId: input.userId,
      taskId,
      provider: input.provider,
      force: true,
    });

    if (result.ok && result.provider) {
      pushed += 1;
    } else if (result.ok) {
      skipped += 1;
    } else {
      failed += 1;
      if (result.error) errors.push(result.error);
    }
  }

  try {
    const accessToken = await getValidAccessToken(input.sql, integration);
    const externalEvents = await PROVIDER_CLIENTS[input.provider].listEvents(
      accessToken,
      integration.calendarId,
      syncWindowStart.toISOString(),
    );

    for (const event of externalEvents) {
      if (new Date(event.dueDate).getTime() < syncWindowStart.getTime()) {
        skipped += 1;
        continue;
      }

      const importResult = await importExternalCalendarEvent({
        sql: input.sql,
        userId: input.userId,
        provider: input.provider,
        event,
      });
      if (importResult === 'created') imported += 1;
      else if (importResult === 'linked') deduplicated += 1;
      else skipped += 1;
    }

    await markIntegrationError(input.sql, integration, failed > 0 ? errors[0] ?? null : null);
  } catch (error) {
    const message = sanitizeSyncError(error, input.provider);
    failed += 1;
    errors.push(message);
    await markIntegrationError(input.sql, integration, message);
  }

  return {
    provider: input.provider,
    pushed,
    imported,
    skipped,
    deduplicated,
    failed,
    errors: Array.from(new Set(errors)).slice(0, 5),
  };
}

export async function removeTaskFromExternalCalendar(input: {
  sql: SqlClient;
  userId: string;
  task?: CalendarTaskForSync | null;
  taskId?: string;
  clearLocalState?: boolean;
}): Promise<{ ok: boolean; provider: CalendarProvider | null; error?: string }> {
  const task = input.task ?? (
    input.taskId ? await getTaskForCalendarSync(input.sql, input.userId, input.taskId) : null
  );
  if (!task?.externalCalendarProvider || !task.externalCalendarEventId) {
    return { ok: true, provider: null };
  }

  const integration = await getCalendarIntegration(input.sql, input.userId, task.externalCalendarProvider);
  if (!integration) {
    return { ok: true, provider: task.externalCalendarProvider };
  }

  try {
    const accessToken = await getValidAccessToken(input.sql, integration);
    await PROVIDER_CLIENTS[integration.provider].deleteEvent(
      accessToken,
      integration.calendarId,
      task.externalCalendarEventId,
    );
    if (input.clearLocalState) {
      await markTaskCalendarSync({
        sql: input.sql,
        userId: input.userId,
        taskId: task.id,
        provider: null,
        eventId: null,
        status: 'idle',
        error: null,
      });
    }
    await markIntegrationError(input.sql, integration, null);
    return { ok: true, provider: integration.provider };
  } catch (error) {
    const message = sanitizeSyncError(error, integration.provider);
    await markIntegrationError(input.sql, integration, message);
    if (input.clearLocalState) {
      await markTaskCalendarSync({
        sql: input.sql,
        userId: input.userId,
        taskId: task.id,
        provider: integration.provider,
        eventId: task.externalCalendarEventId,
        status: 'failed',
        error: message,
      });
    }
    return { ok: false, provider: integration.provider, error: message };
  }
}
