import {
  getAuthFailureResponse,
  requireAuthFromAuthorizationHeader,
  requireAuthFromToken,
} from '../auth.js';
import {
  buildCalendarAuthorizationUrl,
  connectCalendarFromOAuthCallback,
  disconnectCalendarIntegration,
  listCalendarIntegrations,
  syncTaskToExternalCalendar,
  toPublicIntegrations,
  updateCalendarIntegrationSyncEnabled,
} from '../calendar/calendarSync.js';
import type { CalendarProvider } from '../calendar/types.js';
import {
  calendarProviderSchema,
  formatZodError,
  syncTaskCalendarSchema,
  updateCalendarIntegrationSchema,
} from '../schemas.js';
import { logError, logInfo, logWarn } from '../logger.js';
import { getSessionTokenFromCookieHeader } from '../session.js';
import {
  type HandlerContext,
  type HandlerResult,
  empty,
  getRequestMeta,
  json,
  methodNotAllowed,
} from './core.js';

function getStringQueryParam(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function getAppBaseUrl(context: HandlerContext): string {
  const configured = process.env.APP_URL ?? context.defaultAppUrl;
  if (configured) return configured.replace(/\/+$/, '');

  const host = context.request.headers.host;
  const normalizedHost = Array.isArray(host) ? host[0] : host;
  if (normalizedHost) {
    const forwardedProto = context.request.headers['x-forwarded-proto'];
    const protocolValue = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    const protocol = protocolValue?.split(',')[0]?.trim() || (
      normalizedHost.startsWith('localhost') || normalizedHost.startsWith('127.0.0.1')
        ? 'http'
        : 'https'
    );
    return `${protocol}://${normalizedHost}`;
  }

  return 'https://lembreto.vercel.app';
}

function getCalendarRedirectUri(context: HandlerContext, provider: CalendarProvider): string {
  const envName = provider === 'google'
    ? 'GOOGLE_CALENDAR_REDIRECT_URI'
    : 'OUTLOOK_REDIRECT_URI';
  const configured = process.env[envName];
  if (configured) return configured;
  return `${getAppBaseUrl(context)}/api/calendar/${provider}/callback`;
}

function redirectToSettings(context: HandlerContext, params: Record<string, string>) {
  const url = new URL(`${getAppBaseUrl(context)}/`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return empty(302, { Location: url.toString() });
}

async function requireCalendarAuth(context: HandlerContext) {
  try {
    const sessionToken = getSessionTokenFromCookieHeader(context.request.headers.cookie as string | undefined);
    if (sessionToken) {
      return await requireAuthFromToken(context.sql, sessionToken);
    }

    return await requireAuthFromAuthorizationHeader(
      context.sql,
      context.request.headers.authorization as string | undefined,
    );
  } catch (error) {
    const authFailure = getAuthFailureResponse(error);
    if (authFailure) return json(authFailure.status, { error: authFailure.error });
    logError('calendar_auth_failed', error, getRequestMeta(context.request));
    return json(500, { error: 'Erro interno ao autenticar' });
  }
}

function resolveProvider(context: HandlerContext): CalendarProvider | null {
  const rawProvider =
    getStringQueryParam(context.request.query?.provider) ??
    context.request.params?.provider ??
    null;
  const parsed = calendarProviderSchema.safeParse(rawProvider);
  return parsed.success ? parsed.data : null;
}

function resolveTaskId(context: HandlerContext): string | null {
  const queryId = getStringQueryParam(context.request.query?.taskId);
  return queryId ?? context.request.params?.taskId ?? null;
}

export async function handleCalendarIntegrations(context: HandlerContext): Promise<HandlerResult> {
  if (context.request.method !== 'GET') return methodNotAllowed();

  const auth = await requireCalendarAuth(context);
  if ('status' in auth) return auth;

  try {
    const integrations = await listCalendarIntegrations(context.sql, auth.user.id);
    return json(200, { integrations: toPublicIntegrations(integrations) });
  } catch (error) {
    logError('calendar_integrations_list_failed', error, getRequestMeta(context.request, { userId: auth.user.id }));
    return json(500, { error: 'Erro ao carregar calendários conectados' });
  }
}

export async function handleCalendarConnectStart(context: HandlerContext): Promise<HandlerResult> {
  if (context.request.method !== 'GET') return methodNotAllowed();

  const provider = resolveProvider(context);
  if (!provider) return json(400, { error: 'Provedor de calendário inválido' });

  const auth = await requireCalendarAuth(context);
  if ('status' in auth) return auth;

  try {
    const url = buildCalendarAuthorizationUrl({
      provider,
      user: auth.user,
      redirectUri: getCalendarRedirectUri(context, provider),
    });
    return empty(302, { Location: url });
  } catch (error) {
    logError('calendar_connect_start_failed', error, getRequestMeta(context.request, {
      userId: auth.user.id,
      provider,
    }));
    return json(500, { error: 'Calendário externo ainda não configurado neste ambiente' });
  }
}

export async function handleCalendarConnectCallback(context: HandlerContext): Promise<HandlerResult> {
  if (context.request.method !== 'GET') return methodNotAllowed();

  const provider = resolveProvider(context);
  const code = getStringQueryParam(context.request.query?.code);
  const state = getStringQueryParam(context.request.query?.state);
  const oauthError = getStringQueryParam(context.request.query?.error);

  if (!provider) return redirectToSettings(context, { calendar_error: 'Provedor de calendário inválido.' });
  if (oauthError) {
    logWarn('calendar_oauth_denied', getRequestMeta(context.request, { provider, oauthError }));
    return redirectToSettings(context, { calendar_error: 'Conexão com calendário cancelada.' });
  }
  if (!code || !state) {
    return redirectToSettings(context, { calendar_error: 'Não foi possível validar o retorno do calendário.' });
  }

  try {
    const connectedProvider = await connectCalendarFromOAuthCallback({
      sql: context.sql,
      code,
      state,
      redirectUri: getCalendarRedirectUri(context, provider),
    });
    logInfo('calendar_oauth_connected', getRequestMeta(context.request, { provider: connectedProvider }));
    return redirectToSettings(context, { calendar_connected: connectedProvider });
  } catch (error) {
    logError('calendar_oauth_callback_failed', error, getRequestMeta(context.request, { provider }));
    return redirectToSettings(context, { calendar_error: 'Falha ao conectar calendário externo.' });
  }
}

export async function handleCalendarDisconnect(context: HandlerContext): Promise<HandlerResult> {
  if (context.request.method !== 'DELETE') return methodNotAllowed();

  const provider = resolveProvider(context);
  if (!provider) return json(400, { error: 'Provedor de calendário inválido' });

  const auth = await requireCalendarAuth(context);
  if ('status' in auth) return auth;

  try {
    await disconnectCalendarIntegration({
      sql: context.sql,
      userId: auth.user.id,
      provider,
    });
    logInfo('calendar_disconnected', getRequestMeta(context.request, { userId: auth.user.id, provider }));
    return json(200, { ok: true });
  } catch (error) {
    logError('calendar_disconnect_failed', error, getRequestMeta(context.request, { userId: auth.user.id, provider }));
    return json(500, { error: 'Erro ao desconectar calendário' });
  }
}

export async function handleCalendarIntegrationSettings(context: HandlerContext): Promise<HandlerResult> {
  if (context.request.method !== 'PUT') return methodNotAllowed();

  const provider = resolveProvider(context);
  if (!provider) return json(400, { error: 'Provedor de calendário inválido' });

  const parsed = updateCalendarIntegrationSchema.safeParse(context.request.body ?? {});
  if (!parsed.success) return json(400, { error: formatZodError(parsed.error) });

  const auth = await requireCalendarAuth(context);
  if ('status' in auth) return auth;

  try {
    await updateCalendarIntegrationSyncEnabled({
      sql: context.sql,
      userId: auth.user.id,
      provider,
      syncEnabled: parsed.data.syncEnabled,
    });
    const integrations = await listCalendarIntegrations(context.sql, auth.user.id);
    return json(200, { integrations: toPublicIntegrations(integrations) });
  } catch (error) {
    logError('calendar_settings_update_failed', error, getRequestMeta(context.request, { userId: auth.user.id, provider }));
    return json(500, { error: 'Erro ao salvar preferência do calendário' });
  }
}

export async function handleCalendarTaskSync(context: HandlerContext): Promise<HandlerResult> {
  if (context.request.method !== 'POST') return methodNotAllowed();

  const taskId = resolveTaskId(context);
  if (!taskId) return json(400, { error: 'Lembrete não informado' });

  const parsed = syncTaskCalendarSchema.safeParse(context.request.body ?? {});
  if (!parsed.success) return json(400, { error: formatZodError(parsed.error) });

  const auth = await requireCalendarAuth(context);
  if ('status' in auth) return auth;

  try {
    const result = await syncTaskToExternalCalendar({
      sql: context.sql,
      userId: auth.user.id,
      taskId,
      provider: parsed.data.provider,
      force: true,
    });
    if (!result.ok) {
      return json(502, {
        ok: false,
        provider: result.provider,
        error: result.error ?? 'Falha ao sincronizar calendário',
      });
    }

    return json(200, { ok: true, provider: result.provider });
  } catch (error) {
    logError('calendar_task_sync_failed', error, getRequestMeta(context.request, { userId: auth.user.id, taskId }));
    return json(500, { error: 'Erro ao sincronizar lembrete com calendário' });
  }
}
