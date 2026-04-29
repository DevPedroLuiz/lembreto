import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../auth.js';
import { logError, logInfo } from '../logger.js';
import {
  createNoteSchema,
  formatZodError,
  updateNoteSchema,
} from '../schemas.js';
import {
  ensureTaskTaxonomySchema,
  sanitizeTaskTags,
  upsertUserCategory,
  upsertUserTags,
} from '../task-taxonomy.js';
import {
  type HandlerContext,
  type HandlerResult,
  getRequestMeta,
  json,
  methodNotAllowed,
} from './core.js';

function resolveNoteId(context: HandlerContext): string | null {
  const paramId = context.request.params?.id;
  if (paramId) return paramId;

  const queryId = context.request.query?.id;
  if (typeof queryId === 'string') return queryId;
  if (Array.isArray(queryId) && typeof queryId[0] === 'string') return queryId[0];
  return null;
}

async function ensureNotesSchema(sql: HandlerContext['sql']) {
  await ensureTaskTaxonomySchema(sql);

  await sql`
    CREATE TABLE IF NOT EXISTS notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
      category TEXT NOT NULL DEFAULT 'Geral',
      tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      mode TEXT NOT NULL DEFAULT 'temporary' CHECK (mode IN ('temporary', 'fixed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_notes_user_created
    ON notes(user_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_notes_user_mode
    ON notes(user_id, mode, updated_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_notes_task_id
    ON notes(task_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_notes_tags_gin
    ON notes USING GIN(tags)
  `;
}

async function requireNotesAuth(context: HandlerContext) {
  try {
    return await requireAuthFromAuthorizationHeader(
      context.sql,
      context.request.headers.authorization as string | undefined,
    );
  } catch (error) {
    const authFailure = getAuthFailureResponse(error);
    if (authFailure) {
      return json(authFailure.status, { error: authFailure.error });
    }

    logError('notes_auth_failed', error, getRequestMeta(context.request));
    return json(500, { error: 'Erro interno ao autenticar' });
  }
}

async function assertTaskOwnership(
  sql: HandlerContext['sql'],
  userId: string,
  taskId: string | null | undefined,
) {
  if (!taskId) return true;

  const rows = await sql`
    SELECT id
    FROM tasks
    WHERE id = ${taskId} AND user_id = ${userId}
    LIMIT 1
  `;

  return rows.length > 0;
}

async function syncNoteTaxonomy(sql: HandlerContext['sql'], userId: string, category: string, tags: string[]) {
  await upsertUserCategory(sql, userId, category);
  await upsertUserTags(sql, userId, tags);
}

export async function handleNotesCollection(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotesAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  await ensureNotesSchema(sql);

  if (request.method === 'GET') {
    try {
      const rows = await sql`
        SELECT
          id,
          user_id AS "userId",
          task_id AS "taskId",
          title,
          content,
          priority,
          category,
          tags,
          mode,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM notes
        WHERE user_id = ${user.id}
        ORDER BY
          CASE WHEN mode = 'fixed' THEN 0 ELSE 1 END,
          updated_at DESC
      `;

      return json(200, rows);
    } catch (error) {
      logError('notes_list_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao buscar notas' });
    }
  }

  if (request.method === 'POST') {
    const parsed = createNoteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

    const { title, content, priority, category, mode } = parsed.data;
    const tags = sanitizeTaskTags(parsed.data.tags);
    const taskId = parsed.data.taskId ?? null;

    try {
      const canLinkTask = await assertTaskOwnership(sql, user.id, taskId);
      if (!canLinkTask) {
        return json(404, { error: 'Lembrete vinculado nao encontrado' });
      }

      const rows = await sql`
        INSERT INTO notes (user_id, task_id, title, content, priority, category, tags, mode)
        VALUES (
          ${user.id},
          ${taskId},
          ${title},
          ${content},
          ${priority},
          ${category},
          ${tags},
          ${mode}
        )
        RETURNING
          id,
          user_id AS "userId",
          task_id AS "taskId",
          title,
          content,
          priority,
          category,
          tags,
          mode,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `;

      await syncNoteTaxonomy(sql, user.id, category, tags);
      logInfo('note_created', getRequestMeta(request, { userId: user.id, taskId }));
      return json(201, rows[0]);
    } catch (error) {
      logError('note_create_failed', error, getRequestMeta(request, { userId: user.id, taskId }));
      return json(500, { error: 'Erro ao criar nota' });
    }
  }

  return methodNotAllowed();
}

export async function handleNoteById(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotesAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  const id = resolveNoteId(context);
  await ensureNotesSchema(sql);

  if (!id) {
    return json(400, { error: 'Nota nao encontrada' });
  }

  if (request.method === 'PUT') {
    const parsed = updateNoteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

    try {
      const currentRows = await sql`
        SELECT
          title,
          content,
          priority,
          category,
          tags,
          mode,
          task_id
        FROM notes
        WHERE id = ${id} AND user_id = ${user.id}
      `;

      if (currentRows.length === 0) {
        return json(404, { error: 'Nota nao encontrada' });
      }

      const current = currentRows[0] as Record<string, unknown>;
      const taskId = parsed.data.taskId !== undefined ? parsed.data.taskId : (current.task_id as string | null | undefined) ?? null;
      const canLinkTask = await assertTaskOwnership(sql, user.id, taskId);
      if (!canLinkTask) {
        return json(404, { error: 'Lembrete vinculado nao encontrado' });
      }

      const categoryValue = parsed.data.category !== undefined ? parsed.data.category : String(current.category ?? 'Geral');
      const tagsValue = parsed.data.tags ? sanitizeTaskTags(parsed.data.tags) : ((current.tags as string[] | undefined) ?? []);

      const rows = await sql`
        UPDATE notes
        SET
          task_id = ${taskId},
          title = ${parsed.data.title !== undefined ? parsed.data.title : current.title},
          content = ${parsed.data.content !== undefined ? parsed.data.content : current.content},
          priority = ${parsed.data.priority !== undefined ? parsed.data.priority : current.priority},
          category = ${categoryValue},
          tags = ${tagsValue},
          mode = ${parsed.data.mode !== undefined ? parsed.data.mode : current.mode},
          updated_at = NOW()
        WHERE id = ${id} AND user_id = ${user.id}
        RETURNING
          id,
          user_id AS "userId",
          task_id AS "taskId",
          title,
          content,
          priority,
          category,
          tags,
          mode,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `;

      await syncNoteTaxonomy(sql, user.id, categoryValue, tagsValue);
      logInfo('note_updated', getRequestMeta(request, { userId: user.id, noteId: id, taskId }));
      return json(200, rows[0]);
    } catch (error) {
      logError('note_update_failed', error, getRequestMeta(request, { userId: user.id, noteId: id }));
      return json(500, { error: 'Erro ao atualizar nota' });
    }
  }

  if (request.method === 'DELETE') {
    try {
      await sql`
        DELETE FROM notes
        WHERE id = ${id} AND user_id = ${user.id}
      `;
      logInfo('note_deleted', getRequestMeta(request, { userId: user.id, noteId: id }));
      return { status: 204 };
    } catch (error) {
      logError('note_delete_failed', error, getRequestMeta(request, { userId: user.id, noteId: id }));
      return json(500, { error: 'Erro ao excluir nota' });
    }
  }

  return methodNotAllowed();
}
