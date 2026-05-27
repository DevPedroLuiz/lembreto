import { randomUUID } from 'node:crypto';
import type { SqlClient } from '../handlers/core.js';

export type AssistantMessageRole = 'user' | 'assistant' | 'system';
export type AssistantActionStatus = 'success' | 'failed' | 'needs_confirmation' | 'skipped';

export interface AssistantConversation {
  id: string;
  userId: string;
}

export interface AssistantStoredMessage {
  id: string;
  conversationId: string;
  userId: string;
  role: AssistantMessageRole;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AssistantActionEventInput {
  conversationId: string;
  userId: string;
  messageId?: string | null;
  actionType: string;
  status: AssistantActionStatus;
  entityType?: string | null;
  entityId?: string | null;
  entityTitle?: string | null;
  summary?: string | null;
  payload?: unknown;
}

export interface AssistantActionEvent extends AssistantActionEventInput {
  id: string;
  createdAt: string;
}

export interface AssistantContextRefInput {
  conversationId: string;
  userId: string;
  refKey: string;
  entityType: string;
  entityId?: string | null;
  entityTitle?: string | null;
  metadata?: unknown;
  expiresAt?: string | null;
}

export interface AssistantContextRef extends AssistantContextRefInput {
  id: string;
  createdAt: string;
}

export interface AssistantMemoryContext {
  recentMessages: Array<Pick<AssistantStoredMessage, 'role' | 'content'>>;
  recentActions: Array<{
    type: string;
    status: AssistantActionStatus;
    entityType?: string | null;
    entityId?: string | null;
    entityTitle?: string | null;
    summary?: string | null;
  }>;
  contextRefs: {
    lastCreatedTask?: { id: string; title: string };
    lastUpdatedTask?: { id: string; title: string };
    lastRelevantTask?: { id: string; title: string };
    lastListedTasks?: Array<{ id: string; title: string }>;
    lastCreatedNote?: { id: string; title: string };
    pendingConfirmation?: { id: string; title: string; metadata?: unknown };
  };
}

export class AssistantConversationAccessError extends Error {
  constructor() {
    super('Conversa nao encontrada ou indisponivel para este usuario.');
  }
}

function jsonbParameter(sql: SqlClient, value: unknown) {
  return sql.json ? sql.json(value) : JSON.stringify(value);
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapMessage(row: Record<string, unknown>): AssistantStoredMessage {
  return {
    id: String(row.id),
    conversationId: String(row.conversationId),
    userId: String(row.userId),
    role: String(row.role) as AssistantMessageRole,
    content: String(row.content ?? ''),
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

function mapEvent(row: Record<string, unknown>): AssistantActionEvent {
  return {
    id: String(row.id),
    conversationId: String(row.conversationId),
    userId: String(row.userId),
    messageId: typeof row.messageId === 'string' ? row.messageId : null,
    actionType: String(row.actionType),
    status: String(row.status) as AssistantActionStatus,
    entityType: typeof row.entityType === 'string' ? row.entityType : null,
    entityId: typeof row.entityId === 'string' ? row.entityId : null,
    entityTitle: typeof row.entityTitle === 'string' ? row.entityTitle : null,
    summary: typeof row.summary === 'string' ? row.summary : null,
    payload: row.payload,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

function mapRef(row: Record<string, unknown>): AssistantContextRef {
  return {
    id: String(row.id),
    conversationId: String(row.conversationId),
    userId: String(row.userId),
    refKey: String(row.refKey),
    entityType: String(row.entityType),
    entityId: typeof row.entityId === 'string' ? row.entityId : null,
    entityTitle: typeof row.entityTitle === 'string' ? row.entityTitle : null,
    metadata: row.metadata,
    expiresAt: row.expiresAt instanceof Date
      ? row.expiresAt.toISOString()
      : typeof row.expiresAt === 'string'
        ? row.expiresAt
        : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

export async function ensureAssistantConversation(
  sql: SqlClient,
  userId: string,
  conversationId?: string | null,
): Promise<AssistantConversation> {
  if (conversationId) {
    const rows = await sql`
      SELECT id, user_id AS "userId"
      FROM assistant_conversations
      WHERE id = ${conversationId}
        AND user_id = ${userId}
        AND archived_at IS NULL
      LIMIT 1
    `;

    if (rows.length === 0) throw new AssistantConversationAccessError();
    return { id: String(rows[0].id), userId: String(rows[0].userId) };
  }

  const id = randomUUID();
  const rows = await sql`
    INSERT INTO assistant_conversations (id, user_id)
    VALUES (${id}, ${userId})
    RETURNING id, user_id AS "userId"
  `;

  return { id: String(rows[0].id), userId: String(rows[0].userId) };
}

export async function saveAssistantMessage(
  sql: SqlClient,
  input: {
    conversationId: string;
    userId: string;
    role: AssistantMessageRole;
    content: string;
    metadata?: unknown;
  },
): Promise<AssistantStoredMessage> {
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO assistant_messages (id, conversation_id, user_id, role, content, metadata)
    VALUES (
      ${id},
      ${input.conversationId},
      ${input.userId},
      ${input.role},
      ${input.content},
      ${jsonbParameter(sql, input.metadata ?? {})}::jsonb
    )
    RETURNING
      id,
      conversation_id AS "conversationId",
      user_id AS "userId",
      role,
      content,
      metadata,
      created_at AS "createdAt"
  `;

  await sql`
    UPDATE assistant_conversations
    SET updated_at = NOW()
    WHERE id = ${input.conversationId}
      AND user_id = ${input.userId}
  `;

  return mapMessage(rows[0]);
}

export async function getRecentAssistantMessages(
  sql: SqlClient,
  conversationId: string,
  limit = 12,
  userId?: string,
): Promise<AssistantStoredMessage[]> {
  const boundedLimit = Math.min(Math.max(limit, 1), 12);
  const rows = userId
    ? await sql`
      SELECT
        id,
        conversation_id AS "conversationId",
        user_id AS "userId",
        role,
        content,
        metadata,
        created_at AS "createdAt"
      FROM assistant_messages
      WHERE conversation_id = ${conversationId}
        AND user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${boundedLimit}
    `
    : await sql`
      SELECT
        id,
        conversation_id AS "conversationId",
        user_id AS "userId",
        role,
        content,
        metadata,
        created_at AS "createdAt"
      FROM assistant_messages
      WHERE conversation_id = ${conversationId}
      ORDER BY created_at DESC
      LIMIT ${boundedLimit}
    `;

  return rows.map(mapMessage).reverse();
}

export async function getRecentAssistantActionEvents(
  sql: SqlClient,
  conversationId: string,
  limit = 10,
  userId?: string,
): Promise<AssistantActionEvent[]> {
  const boundedLimit = Math.min(Math.max(limit, 1), 10);
  const rows = userId
    ? await sql`
      SELECT
        id,
        conversation_id AS "conversationId",
        user_id AS "userId",
        message_id AS "messageId",
        action_type AS "actionType",
        status,
        entity_type AS "entityType",
        entity_id AS "entityId",
        entity_title AS "entityTitle",
        summary,
        payload,
        created_at AS "createdAt"
      FROM assistant_action_events
      WHERE conversation_id = ${conversationId}
        AND user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${boundedLimit}
    `
    : await sql`
      SELECT
        id,
        conversation_id AS "conversationId",
        user_id AS "userId",
        message_id AS "messageId",
        action_type AS "actionType",
        status,
        entity_type AS "entityType",
        entity_id AS "entityId",
        entity_title AS "entityTitle",
        summary,
        payload,
        created_at AS "createdAt"
      FROM assistant_action_events
      WHERE conversation_id = ${conversationId}
      ORDER BY created_at DESC
      LIMIT ${boundedLimit}
    `;

  return rows.map(mapEvent);
}

export async function getAssistantContextRefs(
  sql: SqlClient,
  conversationId: string,
  limit = 10,
  userId?: string,
): Promise<AssistantContextRef[]> {
  const boundedLimit = Math.min(Math.max(limit, 1), 10);
  const rows = userId
    ? await sql`
      SELECT DISTINCT ON (ref_key)
        id,
        conversation_id AS "conversationId",
        user_id AS "userId",
        ref_key AS "refKey",
        entity_type AS "entityType",
        entity_id AS "entityId",
        entity_title AS "entityTitle",
        metadata,
        expires_at AS "expiresAt",
        created_at AS "createdAt"
      FROM assistant_context_refs
      WHERE conversation_id = ${conversationId}
        AND user_id = ${userId}
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY ref_key, created_at DESC
      LIMIT ${boundedLimit}
    `
    : await sql`
      SELECT DISTINCT ON (ref_key)
        id,
        conversation_id AS "conversationId",
        user_id AS "userId",
        ref_key AS "refKey",
        entity_type AS "entityType",
        entity_id AS "entityId",
        entity_title AS "entityTitle",
        metadata,
        expires_at AS "expiresAt",
        created_at AS "createdAt"
      FROM assistant_context_refs
      WHERE conversation_id = ${conversationId}
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY ref_key, created_at DESC
      LIMIT ${boundedLimit}
    `;

  return rows.map(mapRef);
}

export async function saveAssistantActionEvent(
  sql: SqlClient,
  input: AssistantActionEventInput,
): Promise<AssistantActionEvent> {
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO assistant_action_events (
      id,
      conversation_id,
      user_id,
      message_id,
      action_type,
      status,
      entity_type,
      entity_id,
      entity_title,
      summary,
      payload
    )
    VALUES (
      ${id},
      ${input.conversationId},
      ${input.userId},
      ${input.messageId ?? null},
      ${input.actionType},
      ${input.status},
      ${input.entityType ?? null},
      ${input.entityId ?? null},
      ${input.entityTitle ?? null},
      ${input.summary ?? null},
      ${jsonbParameter(sql, input.payload ?? {})}::jsonb
    )
    RETURNING
      id,
      conversation_id AS "conversationId",
      user_id AS "userId",
      message_id AS "messageId",
      action_type AS "actionType",
      status,
      entity_type AS "entityType",
      entity_id AS "entityId",
      entity_title AS "entityTitle",
      summary,
      payload,
      created_at AS "createdAt"
  `;

  await sql`
    UPDATE assistant_conversations
    SET updated_at = NOW()
    WHERE id = ${input.conversationId}
      AND user_id = ${input.userId}
  `;

  return mapEvent(rows[0]);
}

export async function upsertAssistantContextRef(
  sql: SqlClient,
  input: AssistantContextRefInput,
): Promise<AssistantContextRef> {
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO assistant_context_refs (
      id,
      conversation_id,
      user_id,
      ref_key,
      entity_type,
      entity_id,
      entity_title,
      metadata,
      expires_at
    )
    VALUES (
      ${id},
      ${input.conversationId},
      ${input.userId},
      ${input.refKey},
      ${input.entityType},
      ${input.entityId ?? null},
      ${input.entityTitle ?? null},
      ${jsonbParameter(sql, input.metadata ?? {})}::jsonb,
      ${input.expiresAt ?? null}
    )
    RETURNING
      id,
      conversation_id AS "conversationId",
      user_id AS "userId",
      ref_key AS "refKey",
      entity_type AS "entityType",
      entity_id AS "entityId",
      entity_title AS "entityTitle",
      metadata,
      expires_at AS "expiresAt",
      created_at AS "createdAt"
  `;

  return mapRef(rows[0]);
}

function refEntity(ref: AssistantContextRef): { id: string; title: string } | undefined {
  if (!ref.entityId || !ref.entityTitle) return undefined;
  return { id: ref.entityId, title: ref.entityTitle };
}

function listedTasksFromRef(ref: AssistantContextRef): Array<{ id: string; title: string }> | undefined {
  const metadata = ref.metadata;
  if (!metadata || typeof metadata !== 'object' || !('tasks' in metadata)) return undefined;
  const tasks = (metadata as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return undefined;
  return tasks
    .map((task) => {
      if (!task || typeof task !== 'object') return null;
      const id = (task as { id?: unknown }).id;
      const title = (task as { title?: unknown }).title;
      return typeof id === 'string' && typeof title === 'string' ? { id, title } : null;
    })
    .filter((task): task is { id: string; title: string } => Boolean(task));
}

export async function buildAssistantMemoryContext(
  sql: SqlClient,
  input: { userId: string; conversationId: string },
): Promise<AssistantMemoryContext> {
  const [messages, events, refs] = await Promise.all([
    getRecentAssistantMessages(sql, input.conversationId, 12, input.userId),
    getRecentAssistantActionEvents(sql, input.conversationId, 10, input.userId),
    getAssistantContextRefs(sql, input.conversationId, 10, input.userId),
  ]);

  const refByKey = new Map(refs.map((ref) => [ref.refKey, ref]));
  const pendingConfirmationRef = refByKey.get('pending_confirmation');

  return {
    recentMessages: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    recentActions: events.map((event) => ({
      type: event.actionType,
      status: event.status,
      entityType: event.entityType,
      entityId: event.entityId,
      entityTitle: event.entityTitle,
      summary: event.summary,
    })),
    contextRefs: {
      lastCreatedTask: refByKey.get('last_created_task') ? refEntity(refByKey.get('last_created_task')!) : undefined,
      lastUpdatedTask: refByKey.get('last_updated_task') ? refEntity(refByKey.get('last_updated_task')!) : undefined,
      lastRelevantTask: refByKey.get('last_relevant_task') ? refEntity(refByKey.get('last_relevant_task')!) : undefined,
      lastListedTasks: refByKey.get('last_listed_tasks') ? listedTasksFromRef(refByKey.get('last_listed_tasks')!) : undefined,
      lastCreatedNote: refByKey.get('last_created_note') ? refEntity(refByKey.get('last_created_note')!) : undefined,
      pendingConfirmation: pendingConfirmationRef
        ? {
          id: pendingConfirmationRef.id,
          title: pendingConfirmationRef.entityTitle ?? 'Confirmacao pendente',
          metadata: pendingConfirmationRef.metadata,
        }
        : undefined,
    },
  };
}
