import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  buildTokenJti,
  ensureGoogleAuthSchema,
  ensureUserProfileSchema,
  getAuthFailureResponse,
  requireAuthFromAuthorizationHeader,
  requireAuthFromToken,
} from '../auth.js';
import { isTrustedRequestOrigin } from '../csrf.js';
import { resolveHolidayLocation } from '../holidays.js';
import { extractBearerToken, signToken, verifyToken } from '../jwt.js';
import { logError, logInfo, logWarn } from '../logger.js';
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  sendRecoveryEmail,
} from '../password-reset.js';
import {
  buildSessionCookie,
  buildGoogleOAuthStateCookie,
  clearGoogleOAuthStateCookie,
  clearSessionCookie,
  getGoogleOAuthStateFromCookieHeader,
  getSessionTokenFromCookieHeader,
} from '../session.js';
import { shouldEnforceRecaptcha, verifyRecaptchaToken } from '../recaptcha.js';
import {
  formatZodError,
  loginSchema,
  profileUpdateSchema,
  recoverPasswordSchema,
  registerSchema,
  resetPasswordSchema,
} from '../schemas.js';
import { checkRateLimit, clearRateLimit } from '../../api/_rate_limit.js';
import {
  type HandlerContext,
  type HandlerResult,
  empty,
  getRequestIp,
  getRequestMeta,
  json,
  methodNotAllowed,
} from './core.js';

const GENERIC_RECOVER_RESPONSE = {
  message: 'Se este e-mail estiver cadastrado, voce recebera um link em breve.',
};
const RECAPTCHA_ERROR = 'Confirme que voce nao e um robo.';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

interface UserRow {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  stateCode: string | null;
  cityName: string | null;
  holidayRegionCode: string | null;
}

interface LoginUserRow extends UserRow {
  password_hash: string;
}

interface RecoverUserRow {
  id: string;
  name: string;
}

interface ResetTokenRow {
  token_id: string;
  user_id: string;
}

interface GoogleUserInfo {
  sub?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface ProfileCurrentUserRow {
  name: string;
  email: string;
  password: string;
  avatar: string | null;
  state_code: string | null;
  city_name: string | null;
  holiday_region_code: string | null;
}

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

function getGoogleRedirectUri(context: HandlerContext): string {
  return `${getAppBaseUrl(context)}/api/auth/google/callback`;
}

function redirectToAuthError(context: HandlerContext, message: string, clearState = true): HandlerResult {
  const headers: Record<string, string | string[]> = {
    Location: `${getAppBaseUrl(context)}/?auth_error=${encodeURIComponent(message)}`,
  };

  if (clearState) {
    headers['Set-Cookie'] = clearGoogleOAuthStateCookie();
  }

  return empty(302, headers);
}

async function exchangeGoogleCodeForAccessToken(code: string, redirectUri: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_OAUTH_NOT_CONFIGURED');
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  const data = await response.json().catch(() => ({})) as GoogleTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'GOOGLE_TOKEN_EXCHANGE_FAILED');
  }

  return data.access_token;
}

async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json().catch(() => ({})) as GoogleUserInfo;
  if (!response.ok || !data.sub || !data.email) {
    throw new Error('GOOGLE_USERINFO_FAILED');
  }

  return data;
}

async function findOrCreateGoogleUser(
  sql: HandlerContext['sql'],
  profile: Required<Pick<GoogleUserInfo, 'sub' | 'email'>> & GoogleUserInfo,
): Promise<UserRow> {
  await ensureGoogleAuthSchema(sql);

  const existingByGoogleId = await sql`
    SELECT
      id,
      name,
      email,
      avatar,
      state_code AS "stateCode",
      city_name AS "cityName",
      holiday_region_code AS "holidayRegionCode"
    FROM users
    WHERE google_id = ${profile.sub}
  `;

  if (existingByGoogleId.length > 0) {
    const user = existingByGoogleId[0] as unknown as UserRow;

    const updated = await sql`
      UPDATE users
      SET
        google_id = ${profile.sub}
      WHERE id = ${user.id}
      RETURNING
        id,
        name,
        email,
        avatar,
        state_code AS "stateCode",
        city_name AS "cityName",
        holiday_region_code AS "holidayRegionCode"
    `;

    return updated[0] as unknown as UserRow;
  }

  const existingByEmail = await sql`
    SELECT
      id,
      name,
      email,
      avatar,
      state_code AS "stateCode",
      city_name AS "cityName",
      holiday_region_code AS "holidayRegionCode"
    FROM users
    WHERE email = ${profile.email}
  `;

  if (existingByEmail.length > 0) {
    const user = existingByEmail[0] as unknown as UserRow;
    const linked = await sql`
      UPDATE users
      SET
        google_id = ${profile.sub}
      WHERE id = ${user.id}
      RETURNING
        id,
        name,
        email,
        avatar,
        state_code AS "stateCode",
        city_name AS "cityName",
        holiday_region_code AS "holidayRegionCode"
    `;

    return linked[0] as unknown as UserRow;
  }

  const generatedPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const name = profile.name?.trim() || profile.email.split('@')[0] || 'Usuario Google';
  const rows = await sql`
    INSERT INTO users (name, email, password, avatar, google_id)
    VALUES (${name}, ${profile.email}, ${generatedPasswordHash}, ${null}, ${profile.sub})
    RETURNING
      id,
      name,
      email,
      avatar,
      state_code AS "stateCode",
      city_name AS "cityName",
      holiday_region_code AS "holidayRegionCode"
  `;

  return rows[0] as unknown as UserRow;
}

export async function handleAuthGoogleStart(context: HandlerContext): Promise<HandlerResult> {
  const { request } = context;
  if (request.method !== 'GET') return methodNotAllowed();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logError('auth_google_not_configured', new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET missing'), getRequestMeta(request));
    return redirectToAuthError(context, 'Login com Google ainda nao configurado.');
  }

  const state = crypto.randomBytes(32).toString('hex');
  const authorizationUrl = new URL(GOOGLE_AUTH_URL);
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', getGoogleRedirectUri(context));
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'openid email profile');
  authorizationUrl.searchParams.set('include_granted_scopes', 'true');
  authorizationUrl.searchParams.set('prompt', 'select_account');
  authorizationUrl.searchParams.set('state', state);

  return empty(302, {
    Location: authorizationUrl.toString(),
    'Set-Cookie': buildGoogleOAuthStateCookie(state, GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS),
  });
}

export async function handleAuthGoogleCallback(context: HandlerContext): Promise<HandlerResult> {
  const { request, sql } = context;
  if (request.method !== 'GET') return methodNotAllowed();

  const googleError = getStringQueryParam(request.query?.error);
  if (googleError) {
    logWarn('auth_google_denied', getRequestMeta(request, { googleError }));
    return redirectToAuthError(context, 'Login com Google cancelado.');
  }

  const code = getStringQueryParam(request.query?.code);
  const state = getStringQueryParam(request.query?.state);
  const expectedState = getGoogleOAuthStateFromCookieHeader(request.headers.cookie as string | undefined);

  if (!code || !state || !expectedState || state !== expectedState) {
    logWarn('auth_google_state_mismatch', getRequestMeta(request));
    return redirectToAuthError(context, 'Nao foi possivel validar o login com Google.');
  }

  try {
    const accessToken = await exchangeGoogleCodeForAccessToken(code, getGoogleRedirectUri(context));
    const profile = await fetchGoogleUserInfo(accessToken);

    if (!profile.sub || !profile.email) {
      return redirectToAuthError(context, 'A conta Google nao retornou os dados necessarios.');
    }

    if (profile.email_verified === false) {
      return redirectToAuthError(context, 'Use uma conta Google com e-mail verificado.');
    }

    const user = await findOrCreateGoogleUser(sql, {
      ...profile,
      sub: profile.sub,
      email: profile.email,
    });
    const token = signToken({ sub: user.id, email: user.email });

    logInfo('auth_google_success', getRequestMeta(request, { userId: user.id }));
    return empty(302, {
      Location: `${getAppBaseUrl(context)}/`,
      'Set-Cookie': [
        buildSessionCookie(token, 7 * 24 * 60 * 60),
        clearGoogleOAuthStateCookie(),
      ],
    });
  } catch (error) {
    logError('auth_google_failed', error, getRequestMeta(request));
    return redirectToAuthError(context, 'Falha ao concluir login com Google.');
  }
}

export async function handleAuthRegister(context: HandlerContext): Promise<HandlerResult> {
  const { request, sql } = context;
  if (request.method !== 'POST') return methodNotAllowed();

  const ip = getRequestIp(request);
  const rateLimit = await checkRateLimit(ip, 'register');
  if (!rateLimit.allowed) {
    const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
    logWarn('auth_register_rate_limited', getRequestMeta(request, {
      ip,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    }));
    return json(429, {
      error: `Muitas tentativas. Tente novamente em ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
  }

  const parsed = registerSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  const { name, email, password, recaptchaToken } = parsed.data;

  try {
    if (shouldEnforceRecaptcha()) {
      const recaptchaOk = await verifyRecaptchaToken(recaptchaToken, request);
      if (!recaptchaOk) return json(400, { error: RECAPTCHA_ERROR });
    }

    await ensureUserProfileSchema(sql);

    const existing = await sql`
      SELECT id FROM users WHERE email = ${email}
    `;
    if (existing.length > 0) {
      return json(400, { error: 'Este email ja esta em uso' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const rows = await sql`
      INSERT INTO users (name, email, password)
      VALUES (${name}, ${email}, ${hashedPassword})
      RETURNING
        id,
        name,
        email,
        avatar,
        state_code AS "stateCode",
        city_name AS "cityName",
        holiday_region_code AS "holidayRegionCode"
    `;

    const user = rows[0] as unknown as UserRow;
    await clearRateLimit(ip, 'register');

    const token = signToken({ sub: user.id, email: user.email });
    logInfo('auth_register_success', getRequestMeta(request, { userId: user.id, ip }));

    return json(201, { user, token });
  } catch (error) {
    logError('auth_register_failed', error, getRequestMeta(request, { ip, email }));
    return json(500, { error: 'Erro ao criar usuario' });
  }
}

export async function handleAuthLogin(context: HandlerContext): Promise<HandlerResult> {
  const { request, sql } = context;
  if (request.method !== 'POST') return methodNotAllowed();

  const ip = getRequestIp(request);
  const rateLimit = await checkRateLimit(ip, 'login');
  if (!rateLimit.allowed) {
    const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
    logWarn('auth_login_rate_limited', getRequestMeta(request, {
      ip,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    }));
    return json(429, {
      error: `Muitas tentativas. Tente novamente em ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
  }

  const parsed = loginSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  const { email, password, recaptchaToken } = parsed.data;

  try {
    if (shouldEnforceRecaptcha()) {
      const recaptchaOk = await verifyRecaptchaToken(recaptchaToken, request);
      if (!recaptchaOk) return json(400, { error: RECAPTCHA_ERROR });
    }

    await ensureUserProfileSchema(sql);

    const rows = await sql`
      SELECT
        id,
        name,
        email,
        avatar,
        state_code AS "stateCode",
        city_name AS "cityName",
        holiday_region_code AS "holidayRegionCode",
        password AS password_hash
      FROM users
      WHERE email = ${email}
    `;

    if (rows.length === 0) {
      return json(401, { error: 'Email ou senha incorretos' });
    }

    const user = rows[0] as unknown as LoginUserRow;
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return json(401, { error: 'Email ou senha incorretos' });
    }

    await clearRateLimit(ip, 'login');

      const { password_hash: _passwordHash, ...safeUser } = user;
    const token = signToken({ sub: safeUser.id, email: safeUser.email });
    logInfo('auth_login_success', getRequestMeta(request, { userId: safeUser.id, ip }));

    return json(200, { user: safeUser, token });
  } catch (error) {
    logError('auth_login_failed', error, getRequestMeta(request, { ip, email }));
    return json(500, { error: 'Erro interno' });
  }
}

export async function handleAuthLogout(context: HandlerContext): Promise<HandlerResult> {
  const { request, sql } = context;
  if (request.method !== 'POST') return methodNotAllowed();

  const token = extractBearerToken(request.headers.authorization as string | undefined);
  if (!token) {
    return json(401, { error: 'Nao autorizado' });
  }

  try {
    const payload = verifyToken(token);
    await sql`
      INSERT INTO token_blacklist (token_jti, user_id, expires_at)
      VALUES (
        ${buildTokenJti(payload)},
        ${payload.sub},
        to_timestamp(${payload.exp ?? 0})
      )
      ON CONFLICT (token_jti) DO NOTHING
    `;

    logInfo('auth_logout_success', getRequestMeta(request, { userId: payload.sub }));
    return json(200, { message: 'Logout realizado com sucesso' });
  } catch {
    logWarn('auth_logout_with_invalid_token', getRequestMeta(request));
    return json(200, { message: 'Logout realizado com sucesso' });
  }
}

export async function handleAuthMe(context: HandlerContext): Promise<HandlerResult> {
  const { request, sql } = context;

  if (request.method === 'POST') {
    if (!isTrustedRequestOrigin(request.headers)) {
      logWarn('auth_me_post_csrf_blocked', getRequestMeta(request, {
        host: request.headers.host,
      }));
      return json(403, { error: 'Origem nao permitida' });
    }

    try {
      const { payload, token } = await requireAuthFromAuthorizationHeader(
        sql,
        request.headers.authorization as string | undefined,
      );
      return json(
        200,
        { ok: true, sub: payload.sub },
        { 'Set-Cookie': buildSessionCookie(token, 7 * 24 * 60 * 60) },
      );
    } catch (error) {
      const authFailure = getAuthFailureResponse(error);
      if (authFailure) return json(authFailure.status, { error: authFailure.error });
      logError('auth_me_post_failed', error, getRequestMeta(request));
      return json(500, { error: 'Erro interno' });
    }
  }

  if (request.method === 'GET') {
    const token = getSessionTokenFromCookieHeader(request.headers.cookie as string | undefined);
    if (!token) {
      return json(401, { error: 'Sem sessao ativa' });
    }

    try {
      const { user } = await requireAuthFromToken(sql, token);
      return json(200, { user, token });
    } catch (error) {
      const authFailure = getAuthFailureResponse(error);
      if (authFailure) {
        return json(
          authFailure.status,
          { error: authFailure.error },
          { 'Set-Cookie': clearSessionCookie() },
        );
      }
      logError('auth_me_get_failed', error, getRequestMeta(request));
      return json(500, { error: 'Erro interno' });
    }
  }

  if (request.method === 'DELETE') {
    if (!isTrustedRequestOrigin(request.headers)) {
      logWarn('auth_me_delete_csrf_blocked', getRequestMeta(request, {
        host: request.headers.host,
      }));
      return json(403, { error: 'Origem nao permitida' });
    }

    return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }

  return methodNotAllowed();
}

export async function handleAuthRecover(context: HandlerContext): Promise<HandlerResult> {
  const { request, sql, defaultAppUrl } = context;
  if (request.method !== 'POST') return methodNotAllowed();

  const parsed = recoverPasswordSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  const { email, recaptchaToken } = parsed.data;
  const ip = getRequestIp(request);

  const rateLimit = await checkRateLimit(ip, 'recover');
  if (!rateLimit.allowed) {
    const minutes = Math.ceil((rateLimit.retryAfterSeconds ?? 60) / 60);
    logWarn('auth_recover_rate_limited', getRequestMeta(request, {
      ip,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    }));
    return json(429, {
      error: `Muitas tentativas. Tente novamente em ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
  }

  if (shouldEnforceRecaptcha()) {
    const recaptchaOk = await verifyRecaptchaToken(recaptchaToken, request);
    if (!recaptchaOk) return json(400, { error: RECAPTCHA_ERROR });
  }

  try {
    const rows = await sql`
      SELECT id, name FROM users WHERE email = ${email}
    `;

    if (rows.length > 0) {
      const user = rows[0] as unknown as RecoverUserRow;

      await sql`
        UPDATE password_reset_tokens
        SET used = TRUE
        WHERE user_id = ${user.id} AND used = FALSE AND expires_at > NOW()
      `;

      const { rawToken, tokenHash, expiresAt } = createPasswordResetToken();

      await sql`
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES (${user.id}, ${tokenHash}, ${expiresAt})
      `;

      const appUrl = process.env.APP_URL ?? defaultAppUrl ?? 'https://lembreto.vercel.app';
      const resetLink = `${appUrl}/reset-password?token=${rawToken}`;

      try {
        await sendRecoveryEmail(email, user.name, resetLink);
        logInfo('auth_recover_email_sent', getRequestMeta(request, { userId: user.id }));
      } catch (error) {
        logError('auth_recover_email_failed', error, getRequestMeta(request, { userId: user.id }));
      }
    }

  } catch (error) {
    logError('auth_recover_failed', error, getRequestMeta(request, { ip, email }));
  }

  return json(200, GENERIC_RECOVER_RESPONSE);
}

export async function handleAuthResetPassword(context: HandlerContext): Promise<HandlerResult> {
  const { request, sql } = context;
  if (request.method !== 'POST') return methodNotAllowed();

  const parsed = resetPasswordSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  const { token, password } = parsed.data;

  try {
    const tokenHash = hashPasswordResetToken(token);
    const rows = await sql`
      SELECT id AS token_id, user_id
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
        AND used = FALSE
        AND expires_at > NOW()
    `;

    if (rows.length === 0) {
      return json(400, {
        error: 'Link invalido ou expirado. Solicite um novo link de recuperacao.',
      });
    }

    const { token_id, user_id } = rows[0] as unknown as ResetTokenRow;
    const passwordHash = await bcrypt.hash(password, 12);

    await sql`UPDATE users SET password = ${passwordHash} WHERE id = ${user_id}`;
    await sql`UPDATE password_reset_tokens SET used = TRUE WHERE id = ${token_id}`;

    logInfo('auth_password_reset_success', getRequestMeta(request, { userId: user_id }));
    return json(200, {
      message: 'Senha redefinida com sucesso! Voce ja pode fazer login.',
    });
  } catch (error) {
    logError('auth_password_reset_failed', error, getRequestMeta(request));
    return json(500, { error: 'Erro interno. Tente novamente.' });
  }
}

export async function handleAuthProfile(context: HandlerContext): Promise<HandlerResult> {
  const { request, sql } = context;
  if (request.method !== 'PUT') return methodNotAllowed();

  let auth;
  try {
    auth = await requireAuthFromAuthorizationHeader(
      sql,
      request.headers.authorization as string | undefined,
    );
  } catch (error) {
    const authFailure = getAuthFailureResponse(error);
    if (authFailure) return json(authFailure.status, { error: authFailure.error });
    logError('auth_profile_auth_failed', error, getRequestMeta(request));
    return json(500, { error: 'Erro interno ao autenticar' });
  }

  const parsed = profileUpdateSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  const userId = auth.user.id;
  const {
    name,
    email,
    password,
    avatar,
    stateCode,
    cityName,
    holidayRegionCode,
  } = parsed.data;

  try {
    await ensureUserProfileSchema(sql);

    if (email) {
      const conflict = await sql`
        SELECT id FROM users
        WHERE email = ${email} AND id != ${userId}
      `;
      if (conflict.length > 0) {
        return json(400, { error: 'Este email ja esta em uso' });
      }
    }

    const current = await sql`
      SELECT
        name,
        email,
        password,
        avatar,
        state_code,
        city_name,
        holiday_region_code
      FROM users
      WHERE id = ${userId}
    `;
    if (current.length === 0) {
      return json(404, { error: 'Usuario nao encontrado' });
    }

    const cur = current[0] as unknown as ProfileCurrentUserRow;
    let newPasswordHash = cur.password;
    if (password && password.trim()) {
      newPasswordHash = await bcrypt.hash(password.trim(), 12);
    }

    const resolvedLocation = resolveHolidayLocation(
      stateCode !== undefined ? stateCode : cur.state_code,
      cityName !== undefined ? cityName : cur.city_name,
    );
    const nextStateCode = stateCode !== undefined ? resolvedLocation.stateCode : cur.state_code;
    const nextCityName = cityName !== undefined ? resolvedLocation.cityName : cur.city_name;
    const nextRegionCode = holidayRegionCode !== undefined
      ? holidayRegionCode
      : (stateCode !== undefined || cityName !== undefined)
        ? resolvedLocation.regionCode
        : cur.holiday_region_code;

    const nextEmail = email || cur.email;
    const shouldRotateToken =
      Boolean(password && password.trim()) || nextEmail !== auth.user.email;

    const rows = await sql`
      UPDATE users SET
        name     = ${name || cur.name},
        email    = ${nextEmail},
        password = ${newPasswordHash},
        avatar   = ${avatar !== undefined ? avatar : cur.avatar},
        state_code = ${nextStateCode},
        city_name = ${nextCityName},
        holiday_region_code = ${nextRegionCode}
      WHERE id = ${userId}
      RETURNING
        id,
        name,
        email,
        avatar,
        state_code AS "stateCode",
        city_name AS "cityName",
        holiday_region_code AS "holidayRegionCode"
    `;

    const user = rows[0] as unknown as UserRow;

    if (shouldRotateToken) {
      await sql`
        INSERT INTO token_blacklist (token_jti, user_id, expires_at)
        VALUES (
          ${buildTokenJti(auth.payload)},
          ${auth.payload.sub},
          to_timestamp(${auth.payload.exp ?? 0})
        )
        ON CONFLICT (token_jti) DO NOTHING
      `;

      const rotatedToken = signToken({ sub: user.id, email: user.email });
      logInfo('auth_profile_updated_with_token_rotation', getRequestMeta(request, { userId: user.id }));
      return json(200, { user, token: rotatedToken });
    }

    logInfo('auth_profile_updated', getRequestMeta(request, { userId: user.id }));
    return json(200, { user });
  } catch (error) {
    logError('auth_profile_update_failed', error, getRequestMeta(request, { userId }));
    return json(500, { error: 'Erro ao atualizar perfil' });
  }
}
