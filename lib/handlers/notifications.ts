import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../auth.js';
import { logError, logInfo, logWarn } from '../logger.js';
import {
  clearNotificationsForUser,
  createNotification,
  generateScheduledNotifications,
  getNotificationsEnabled,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationReadState,
  NotificationReferenceUnavailableError,
  setNotificationsEnabled,
} from '../notifications.js';
import {
  createNotificationSchema,
  formatZodError,
  updateNotificationSchema,
  updateNotificationSettingsSchema,
} from '../schemas.js';
import {
  type HandlerContext,
  type HandlerResult,
  getRequestMeta,
  json,
  methodNotAllowed,
} from './core.js';

function isAuthorizedCronRequest(context: HandlerContext): boolean {
  const vercelCronHeader = context.request.headers['x-vercel-cron'];
  if (vercelCronHeader === '1') return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = context.request.headers.authorization;
  return authHeader === `Bearer ${secret}`;
}

async function requireNotificationAuth(context: HandlerContext) {
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

    logError('notifications_auth_failed', error, getRequestMeta(context.request));
    return json(500, { error: 'Erro interno ao autenticar' });
  }
}

function resolveNotificationId(context: HandlerContext): string | null {
  const paramId = context.request.params?.id;
  if (paramId) return paramId;

  const queryId = context.request.query?.id;
  if (typeof queryId === 'string') return queryId;
  if (Array.isArray(queryId) && typeof queryId[0] === 'string') return queryId[0];
  return null;
}

export async function handleNotificationsCollection(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  if (request.method === 'GET') {
    try {
      const [notifications, enabled] = await Promise.all([
        listNotificationsForUser(sql, user.id),
        getNotificationsEnabled(sql, user.id),
      ]);
      return json(200, { notifications, enabled });
    } catch (error) {
      logError('notifications_list_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao buscar notificacoes' });
    }
  }

  if (request.method === 'POST') {
    const parsed = createNotificationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

    try {
      const result = await createNotification(sql, {
        userId: user.id,
        ...parsed.data,
      });
      logInfo('notification_created', getRequestMeta(request, {
        userId: user.id,
        notificationId: result.notification.id,
        created: result.created,
      }));
      return json(result.created ? 201 : 200, result);
    } catch (error) {
      if (error instanceof NotificationReferenceUnavailableError) {
        logWarn('notification_create_skipped_missing_reference', getRequestMeta(request, {
          userId: user.id,
        }));
        return json(409, { error: 'Referencia da notificacao nao esta mais disponivel' });
      }

      logError('notification_create_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao registrar notificacao' });
    }
  }

  if (request.method === 'DELETE') {
    try {
      const deletedCount = await clearNotificationsForUser(sql, user.id);
      logInfo('notifications_cleared', getRequestMeta(request, { userId: user.id, deletedCount }));
      return json(200, { deletedCount });
    } catch (error) {
      logError('notifications_clear_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao limpar notificacoes' });
    }
  }

  return methodNotAllowed();
}

export async function handleNotificationById(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;
  const id = resolveNotificationId(context);

  if (!id) {
    return json(400, { error: 'Notificacao nao encontrada' });
  }

  if (request.method !== 'PUT') return methodNotAllowed();

  const parsed = updateNotificationSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: 'Envie o campo "read" com true ou false.' });
  }

  try {
    const notification = await markNotificationReadState(sql, user.id, id, parsed.data.read);
    if (!notification) {
      return json(404, { error: 'Notificacao nao encontrada' });
    }

    logInfo('notification_updated', getRequestMeta(request, { userId: user.id, notificationId: id }));
    return json(200, { notification });
  } catch (error) {
    logError('notification_update_failed', error, getRequestMeta(request, { userId: user.id, notificationId: id }));
    return json(500, { error: 'Erro ao atualizar notificacao' });
  }
}

export async function handleNotificationMarkAllRead(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  if (request.method !== 'POST') return methodNotAllowed();

  try {
    const updatedCount = await markAllNotificationsRead(sql, user.id);
    logInfo('notifications_mark_all_read', getRequestMeta(request, { userId: user.id, updatedCount }));
    return json(200, { updatedCount });
  } catch (error) {
    logError('notifications_mark_all_read_failed', error, getRequestMeta(request, { userId: user.id }));
    return json(500, { error: 'Erro ao marcar notificacoes como lidas' });
  }
}

export async function handleNotificationSettings(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireNotificationAuth(context);
  if ('status' in auth) return auth;

  const user = auth.user;
  const { request, sql } = context;

  if (request.method === 'GET') {
    try {
      const enabled = await getNotificationsEnabled(sql, user.id);
      return json(200, { enabled });
    } catch (error) {
      logError('notification_settings_get_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao carregar preferencia de notificacoes' });
    }
  }

  if (request.method === 'PUT') {
    const parsed = updateNotificationSettingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: 'Envie o campo "enabled" com true ou false.' });
    }

    try {
      await setNotificationsEnabled(sql, user.id, parsed.data.enabled);
      logInfo('notification_settings_updated', getRequestMeta(request, { userId: user.id, enabled: parsed.data.enabled }));
      return json(200, { enabled: parsed.data.enabled });
    } catch (error) {
      logError('notification_settings_update_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao salvar preferencia de notificacoes' });
    }
  }

  return methodNotAllowed();
}

export async function handleNotificationsCron(context: HandlerContext): Promise<HandlerResult> {
  const { request, sql } = context;

  if (request.method !== 'GET') return methodNotAllowed();

  if (!isAuthorizedCronRequest(context)) {
    return json(401, { error: 'Nao autorizado' });
  }

  try {
    const result = await generateScheduledNotifications(sql);
    logInfo('cron_notifications_completed', getRequestMeta(request, {
      scannedTasks: result.scannedTasks,
      createdNotifications: result.createdNotifications,
    }));
    return json(200, { ok: true, ...result });
  } catch (error) {
    logError('cron_notifications_failed', error, getRequestMeta(request));
    return json(500, { error: 'Erro ao gerar notificacoes agendadas' });
  }
}
