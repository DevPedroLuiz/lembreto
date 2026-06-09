import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../auth.js';
import { logError, logInfo } from '../logger.js';
import { assertInfrastructure } from '../infrastructure.js';
import {
  createNoteSchema,
  formatZodError,
  updateNoteSchema,
} from '../schemas.js';
import { createNotification } from '../notifications.js';
import { requireCurrentOrganization } from '../organizations.js';
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

function wantsTrash(request: HandlerContext['request']) {
  const value = request.query?.trash;
  if (Array.isArray(value)) return value[0] === '1' || value[0] === 'true';
  return value === '1' || value === 'true';
}

function normalizeNoteExpiry(mode: 'temporary' | 'fixed', expiresAt: string | null | undefined) {
  if (mode === 'fixed') return null;
  if (!expiresAt) {
    return { error: 'Defina por quanto tempo a nota temporária deve permanecer no sistema.' };
  }

  const expiresAtDate = new Date(expiresAt);
  if (Number.isNaN(expiresAtDate.getTime())) {
    return { error: 'Validade da nota inválida.' };
  }

  if (expiresAtDate.getTime() <= Date.now()) {
    return { error: 'A validade da nota temporária precisa estar no futuro.' };
  }

  return expiresAtDate.toISOString();
}

let notesSchemaReady: Promise<void> | null = null;

async function ensureNotesSchema(sql: HandlerContext['sql']) {
  notesSchemaReady ??= (async () => {
    await ensureTaskTaxonomySchema(sql);
    await assertInfrastructure(sql, 'notes', {
      relations: [
        { name: 'notes' },
      ],
      columns: [
        { table: 'notes', column: 'expires_at' },
        { table: 'notes', column: 'deleted_at' },
        { table: 'notes', column: 'delete_after' },
        { table: 'notes', column: 'deletion_reason' },
        { table: 'notes', column: 'expired_notification_sent_at' },
        { table: 'notes', column: 'organization_id' },
      ],
      indexes: [
        { name: 'idx_notes_user_created' },
        { name: 'idx_notes_user_mode' },
        { name: 'idx_notes_expiration' },
        { name: 'idx_notes_trash_cleanup' },
        { name: 'idx_notes_task_id' },
        { name: 'idx_notes_tags_gin' },
      ],
      constraints: [
        {
          table: 'notes',
          name: 'notes_deletion_reason_check',
          contains: ['manual', 'expired'],
        },
      ],
    });
  })().catch((error) => {
    notesSchemaReady = null;
    throw error;
  });

  await notesSchemaReady;
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
  organizationId: string,
  taskId: string | null | undefined,
) {
  if (!taskId) return true;

  const rows = await sql`
    SELECT id
    FROM tasks
    WHERE id = ${taskId} AND organization_id = ${organizationId}
    LIMIT 1
  `;

  return rows.length > 0;
}

async function syncNoteTaxonomy(sql: HandlerContext['sql'], userId: string, category: string, tags: string[]) {
  await upsertUserCategory(sql, userId, category);
  await upsertUserTags(sql, userId, tags);
}

async function purgeExpiredTrash(sql: HandlerContext['sql'], organizationId: string) {
  await sql`
    DELETE FROM notes
    WHERE organization_id = ${organizationId}
      AND deleted_at IS NOT NULL
      AND delete_after IS NOT NULL
      AND delete_after <= NOW()
  `;
}

async function moveExpiredTemporaryNotesToTrash(
  sql: HandlerContext['sql'],
  userId: string,
  organizationId: string,
) {
  const expiredNotes = await sql`
    UPDATE notes
    SET
      deleted_at = NOW(),
      delete_after = NOW() + INTERVAL '3 days',
      deletion_reason = 'expired',
      expired_notification_sent_at = NOW(),
      updated_at = NOW()
    WHERE organization_id = ${organizationId}
      AND deleted_at IS NULL
      AND mode = 'temporary'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
    RETURNING id, title
  `;

  await Promise.allSettled(
    expiredNotes.map(async (note) => {
      await createNotification(sql, {
        userId,
        organizationId,
        title: 'Nota temporária excluída',
        message: `"${String(note.title)}" venceu e foi enviada para a Lixeira. Ela ficará disponível por 3 dias.`,
        tone: 'warning',
        target: { type: 'notifications' },
        dedupeKey: `note-expired:${String(note.id)}`,
      });
    }),
  );

  return expiredNotes.length;
}

export async function handleNotesCollection(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotesAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  await ensureNotesSchema(sql);
  const organization = await requireCurrentOrganization(sql, user);
  const organizationId = organization.id;

  if (request.method === 'GET') {
    try {
      await purgeExpiredTrash(sql, organizationId);
      await moveExpiredTemporaryNotesToTrash(sql, user.id, organizationId);

      const includeTrash = wantsTrash(request);
      const rows = await sql`
        SELECT
          id,
          user_id AS "userId",
          organization_id AS "organizationId",
          task_id AS "taskId",
          title,
          content,
          priority,
          category,
          tags,
          mode,
          expires_at AS "expiresAt",
          deleted_at AS "deletedAt",
          delete_after AS "deleteAfter",
          deletion_reason AS "deletionReason",
          expired_notification_sent_at AS "expiredNotificationSentAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM notes
        WHERE organization_id = ${organizationId}
          AND (
            (${includeTrash}::boolean = FALSE AND deleted_at IS NULL)
            OR (${includeTrash}::boolean = TRUE AND deleted_at IS NOT NULL)
          )
        ORDER BY
          CASE WHEN ${includeTrash}::boolean = TRUE THEN 0 WHEN mode = 'fixed' THEN 0 ELSE 1 END,
          deleted_at DESC NULLS LAST,
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
    const expiresAt = normalizeNoteExpiry(mode, parsed.data.expiresAt);

    if (expiresAt && typeof expiresAt === 'object') {
      return json(400, { error: expiresAt.error });
    }

    try {
      const canLinkTask = await assertTaskOwnership(sql, organizationId, taskId);
      if (!canLinkTask) {
        return json(404, { error: 'Lembrete vinculado não encontrado' });
      }

      const rows = await sql`
        INSERT INTO notes (user_id, organization_id, task_id, title, content, priority, category, tags, mode, expires_at)
        VALUES (
          ${user.id},
          ${organizationId},
          ${taskId},
          ${title},
          ${content},
          ${priority},
          ${category},
          ${tags},
          ${mode},
          ${expiresAt}
        )
        RETURNING
          id,
          user_id AS "userId",
          organization_id AS "organizationId",
          task_id AS "taskId",
          title,
          content,
          priority,
          category,
          tags,
          mode,
          expires_at AS "expiresAt",
          deleted_at AS "deletedAt",
          delete_after AS "deleteAfter",
          deletion_reason AS "deletionReason",
          expired_notification_sent_at AS "expiredNotificationSentAt",
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
  const organization = await requireCurrentOrganization(sql, user);
  const organizationId = organization.id;

  if (!id) {
    return json(400, { error: 'Nota não encontrada' });
  }

  if (request.method === 'GET') {
    try {
      const rows = await sql`
        SELECT
          id,
          user_id AS "userId",
          organization_id AS "organizationId",
          task_id AS "taskId",
          title,
          content,
          priority,
          category,
          tags,
          mode,
          expires_at AS "expiresAt",
          deleted_at AS "deletedAt",
          delete_after AS "deleteAfter",
          deletion_reason AS "deletionReason",
          expired_notification_sent_at AS "expiredNotificationSentAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM notes
        WHERE id = ${id}
          AND organization_id = ${organizationId}
          AND deleted_at IS NULL
      `;

      if (rows.length === 0) {
        return json(404, { error: 'Nota nÃ£o encontrada' });
      }

      return json(200, rows[0]);
    } catch (error) {
      logError('note_get_failed', error, getRequestMeta(request, { userId: user.id, noteId: id }));
      return json(500, { error: 'Erro ao buscar nota' });
    }
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
          expires_at,
          task_id,
          deleted_at
        FROM notes
        WHERE id = ${id} AND organization_id = ${organizationId}
      `;

      if (currentRows.length === 0) {
        return json(404, { error: 'Nota não encontrada' });
      }

      const current = currentRows[0] as Record<string, unknown>;
      const taskId = parsed.data.taskId !== undefined ? parsed.data.taskId : (current.task_id as string | null | undefined) ?? null;
      const canLinkTask = await assertTaskOwnership(sql, organizationId, taskId);
      if (!canLinkTask) {
        return json(404, { error: 'Lembrete vinculado não encontrado' });
      }

      const nextMode = parsed.data.mode !== undefined ? parsed.data.mode : (current.mode as 'temporary' | 'fixed');
      const currentExpiresAt = current.expires_at instanceof Date
        ? current.expires_at.toISOString()
        : typeof current.expires_at === 'string'
          ? current.expires_at
          : null;
      const nextExpiresAtInput = parsed.data.expiresAt !== undefined ? parsed.data.expiresAt : currentExpiresAt;
      const expiresAt = normalizeNoteExpiry(nextMode, nextExpiresAtInput);

      if (expiresAt && typeof expiresAt === 'object') {
        return json(400, { error: expiresAt.error });
      }

      if (current.deleted_at && !parsed.data.restore) {
        return json(409, { error: 'Restaure a nota antes de editá-la.' });
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
          mode = ${nextMode},
          expires_at = ${expiresAt},
          deleted_at = CASE WHEN ${parsed.data.restore === true}::boolean THEN NULL ELSE deleted_at END,
          delete_after = CASE WHEN ${parsed.data.restore === true}::boolean THEN NULL ELSE delete_after END,
          deletion_reason = CASE WHEN ${parsed.data.restore === true}::boolean THEN NULL ELSE deletion_reason END,
          expired_notification_sent_at = CASE WHEN ${parsed.data.restore === true}::boolean THEN NULL ELSE expired_notification_sent_at END,
          updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${organizationId}
        RETURNING
          id,
          user_id AS "userId",
          organization_id AS "organizationId",
          task_id AS "taskId",
          title,
          content,
          priority,
          category,
          tags,
          mode,
          expires_at AS "expiresAt",
          deleted_at AS "deletedAt",
          delete_after AS "deleteAfter",
          deletion_reason AS "deletionReason",
          expired_notification_sent_at AS "expiredNotificationSentAt",
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
        UPDATE notes
        SET
          deleted_at = COALESCE(deleted_at, NOW()),
          delete_after = COALESCE(delete_after, NOW() + INTERVAL '3 days'),
          deletion_reason = COALESCE(deletion_reason, 'manual'),
          updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${organizationId}
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
