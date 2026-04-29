import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../auth.js';
import { logError, logInfo } from '../logger.js';
import {
  createTaskCategorySchema,
  createTaskSchema,
  createTaskTagSchema,
  formatZodError,
  updateTaskSchema,
} from '../schemas.js';
import {
  ensureTaskTaxonomySchema,
  getTaskTaxonomy,
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

function resolveTaskId(context: HandlerContext): string | null {
  const paramId = context.request.params?.id;
  if (paramId) return paramId;

  const queryId = context.request.query?.id;
  if (typeof queryId === 'string') return queryId;
  if (Array.isArray(queryId) && typeof queryId[0] === 'string') return queryId[0];
  return null;
}

async function requireTaskAuth(context: HandlerContext) {
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

    logError('task_auth_failed', error, getRequestMeta(context.request));
    return json(500, { error: 'Erro interno ao autenticar' });
  }
}

async function syncTaskTaxonomy(sql: HandlerContext['sql'], userId: string, category: string, tags: string[]) {
  await upsertUserCategory(sql, userId, category);
  await upsertUserTags(sql, userId, tags);
}

export async function handleTasksCollection(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  await ensureTaskTaxonomySchema(sql);

  if (request.method === 'GET') {
    try {
      const rows = await sql`
        SELECT
          id,
          user_id     AS "userId",
          title,
          description,
          due_date    AS "dueDate",
          priority,
          category,
          tags,
          status,
          created_at  AS "createdAt"
        FROM tasks
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC
      `;
      return json(200, rows);
    } catch (error) {
      logError('tasks_list_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao buscar tarefas' });
    }
  }

  if (request.method === 'POST') {
    const parsed = createTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

    const { title, description, dueDate, priority, category } = parsed.data;
    const tags = sanitizeTaskTags(parsed.data.tags);

    try {
      const rows = await sql`
        INSERT INTO tasks (user_id, title, description, due_date, priority, category, tags)
        VALUES (
          ${user.id},
          ${title},
          ${description},
          ${dueDate || null},
          ${priority},
          ${category},
          ${tags}
        )
        RETURNING
          id,
          user_id     AS "userId",
          title,
          description,
          due_date    AS "dueDate",
          priority,
          category,
          tags,
          status,
          created_at  AS "createdAt"
      `;

      await syncTaskTaxonomy(sql, user.id, category, tags);
      logInfo('task_created', getRequestMeta(request, { userId: user.id }));
      return json(201, rows[0]);
    } catch (error) {
      logError('task_create_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao criar tarefa' });
    }
  }

  return methodNotAllowed();
}

export async function handleTaskById(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  const id = resolveTaskId(context);

  await ensureTaskTaxonomySchema(sql);

  if (!id) {
    return json(400, { error: 'Tarefa nao encontrada' });
  }

  if (request.method === 'PUT') {
    const parsed = updateTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

    const { title, description, dueDate, priority, category, status } = parsed.data;
    const nextTags = parsed.data.tags ? sanitizeTaskTags(parsed.data.tags) : undefined;

    try {
      const current = await sql`
        SELECT title, description, due_date, priority, category, tags, status
        FROM tasks WHERE id = ${id} AND user_id = ${user.id}
      `;
      if (current.length === 0) {
        return json(404, { error: 'Tarefa nao encontrada' });
      }

      const cur = current[0] as Record<string, unknown>;
      const categoryValue = category !== undefined ? category : String(cur.category ?? 'Geral');
      const tagsValue = nextTags ?? ((cur.tags as string[] | undefined) ?? []);

      const rows = await sql`
        UPDATE tasks SET
          title       = ${title !== undefined ? title : cur.title},
          description = ${description !== undefined ? description : cur.description},
          due_date    = ${dueDate !== undefined ? dueDate || null : cur.due_date},
          priority    = ${priority !== undefined ? priority : cur.priority},
          category    = ${categoryValue},
          tags        = ${tagsValue},
          status      = ${status !== undefined ? status : cur.status}
        WHERE id = ${id} AND user_id = ${user.id}
        RETURNING
          id,
          user_id     AS "userId",
          title,
          description,
          due_date    AS "dueDate",
          priority,
          category,
          tags,
          status,
          created_at  AS "createdAt"
      `;

      await syncTaskTaxonomy(sql, user.id, categoryValue, tagsValue);
      logInfo('task_updated', getRequestMeta(request, { userId: user.id, taskId: id }));
      return json(200, rows[0]);
    } catch (error) {
      logError('task_update_failed', error, getRequestMeta(request, { userId: user.id, taskId: id }));
      return json(500, { error: 'Erro ao atualizar tarefa' });
    }
  }

  if (request.method === 'DELETE') {
    try {
      await sql`DELETE FROM tasks WHERE id = ${id} AND user_id = ${user.id}`;
      logInfo('task_deleted', getRequestMeta(request, { userId: user.id, taskId: id }));
      return { status: 204 };
    } catch (error) {
      logError('task_delete_failed', error, getRequestMeta(request, { userId: user.id, taskId: id }));
      return json(500, { error: 'Erro ao deletar tarefa' });
    }
  }

  return methodNotAllowed();
}

export async function handleTaskTaxonomy(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  try {
    const taxonomy = await getTaskTaxonomy(sql, user.id);
    return json(200, taxonomy);
  } catch (error) {
    logError('task_taxonomy_list_failed', error, getRequestMeta(request, { userId: user.id }));
    return json(500, { error: 'Erro ao carregar categorias e tags' });
  }
}

export async function handleTaskCategoriesCollection(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  if (request.method !== 'POST') return methodNotAllowed();

  const parsed = createTaskCategorySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  try {
    await upsertUserCategory(sql, user.id, parsed.data.name);
    logInfo('task_category_created', getRequestMeta(request, { userId: user.id, category: parsed.data.name }));
    return json(201, { category: parsed.data.name.trim() });
  } catch (error) {
    logError('task_category_create_failed', error, getRequestMeta(request, { userId: user.id }));
    return json(500, { error: 'Erro ao criar categoria' });
  }
}

export async function handleTaskTagsCollection(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireTaskAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  if (request.method !== 'POST') return methodNotAllowed();

  const parsed = createTaskTagSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  const tag = parsed.data.name.trim();

  try {
    await upsertUserTags(sql, user.id, [tag]);
    logInfo('task_tag_created', getRequestMeta(request, { userId: user.id, tag }));
    return json(201, { tag });
  } catch (error) {
    logError('task_tag_create_failed', error, getRequestMeta(request, { userId: user.id }));
    return json(500, { error: 'Erro ao criar tag' });
  }
}
