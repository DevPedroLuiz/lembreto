import bcrypt from 'bcryptjs';
import {
  buildTokenJti,
  getAuthFailureResponse,
  requireAuthFromAuthorizationHeader,
  requireAuthFromToken,
} from '../auth.js';
import { isTrustedRequestOrigin } from '../csrf.js';
import { extractBearerToken, signToken, verifyToken } from '../jwt.js';
import { logError, logInfo, logWarn } from '../logger.js';
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  sendRecoveryEmail,
} from '../password-reset.js';
import {
  buildSessionCookie,
  clearSessionCookie,
  getSessionTokenFromCookieHeader,
} from '../session.js';
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
  getRequestIp,
  getRequestMeta,
  json,
  methodNotAllowed,
} from './core.js';

const GENERIC_RECOVER_RESPONSE = {
  message: 'Se este e-mail estiver cadastrado, voce recebera um link em breve.',
};

interface UserRow {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
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

interface ProfileCurrentUserRow {
  name: string;
  email: string;
  password: string;
  avatar: string | null;
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

  const { name, email, password } = parsed.data;

  try {
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
      RETURNING id, name, email, avatar
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

  const { email, password } = parsed.data;

  try {
    const rows = await sql`
      SELECT id, name, email, avatar, password AS password_hash
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

  const { email } = parsed.data;

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
    logError('auth_recover_failed', error, getRequestMeta(request, { email }));
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
  const { name, email, password, avatar } = parsed.data;

  try {
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
      SELECT name, email, password, avatar FROM users WHERE id = ${userId}
    `;
    if (current.length === 0) {
      return json(404, { error: 'Usuario nao encontrado' });
    }

    const cur = current[0] as unknown as ProfileCurrentUserRow;
    let newPasswordHash = cur.password;
    if (password && password.trim()) {
      newPasswordHash = await bcrypt.hash(password.trim(), 12);
    }

    const nextEmail = email || cur.email;
    const shouldRotateToken =
      Boolean(password && password.trim()) || nextEmail !== auth.user.email;

    const rows = await sql`
      UPDATE users SET
        name     = ${name || cur.name},
        email    = ${nextEmail},
        password = ${newPasswordHash},
        avatar   = ${avatar !== undefined ? avatar : cur.avatar}
      WHERE id = ${userId}
      RETURNING id, name, email, avatar
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
