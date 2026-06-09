import { extractBearerToken, verifyToken, type JwtPayload } from './jwt.js';
import type { SqlClient } from './handlers/core.js';
import { assertInfrastructure } from './infrastructure.js';
import {
  ensurePersonalOrganization,
  type CurrentOrganization,
} from './organizations.js';

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt?: string | null;
  avatar?: string | null;
  stateCode?: string | null;
  cityName?: string | null;
  holidayRegionCode?: string | null;
  currentOrganization?: CurrentOrganization;
}

type AuthErrorCode =
  | 'MISSING_TOKEN'
  | 'INVALID_TOKEN'
  | 'TOKEN_BLACKLISTED'
  | 'USER_NOT_FOUND';

export class AuthError extends Error {
  code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code);
    this.code = code;
  }
}

let ensureUserProfileSchemaPromise: Promise<void> | null = null;
let ensureGoogleAuthSchemaPromise: Promise<void> | null = null;
let ensureAuthSecuritySchemaPromise: Promise<void> | null = null;

export async function ensureUserProfileSchema(sql: SqlClient) {
  if (!ensureUserProfileSchemaPromise) {
    ensureUserProfileSchemaPromise = (async () => {
      await assertInfrastructure(sql, 'user profile', {
        columns: [
          { table: 'users', column: 'state_code' },
          { table: 'users', column: 'city_name' },
          { table: 'users', column: 'holiday_region_code' },
          { table: 'users', column: 'email_verified_at' },
        ],
      });
    })().catch((error) => {
      ensureUserProfileSchemaPromise = null;
      throw error;
    });
  }

  await ensureUserProfileSchemaPromise;
}

export async function ensureAuthSecuritySchema(sql: SqlClient) {
  if (!ensureAuthSecuritySchemaPromise) {
    ensureAuthSecuritySchemaPromise = (async () => {
      await ensureUserProfileSchema(sql);
      await assertInfrastructure(sql, 'auth security', {
        relations: [
          { name: 'auth_sessions' },
          { name: 'email_verification_tokens' },
        ],
        columns: [
          { table: 'auth_sessions', column: 'token_jti' },
          { table: 'auth_sessions', column: 'last_seen_at' },
          { table: 'auth_sessions', column: 'revoked_at' },
          { table: 'email_verification_tokens', column: 'token_hash' },
          { table: 'email_verification_tokens', column: 'email' },
        ],
        indexes: [
          { name: 'idx_auth_sessions_user_last_seen' },
          { name: 'idx_evt_token_hash' },
        ],
        constraints: [
          {
            table: 'auth_rate_limit',
            name: 'auth_rate_limit_route_check',
            contains: ['bulk_create', 'verify_email'],
          },
        ],
      });
    })().catch((error) => {
      ensureAuthSecuritySchemaPromise = null;
      throw error;
    });
  }

  await ensureAuthSecuritySchemaPromise;
}

export async function ensureGoogleAuthSchema(sql: SqlClient) {
  if (!ensureGoogleAuthSchemaPromise) {
    ensureGoogleAuthSchemaPromise = (async () => {
      await ensureUserProfileSchema(sql);
      await assertInfrastructure(sql, 'google auth', {
        columns: [
          { table: 'users', column: 'google_id' },
        ],
        indexes: [
          { name: 'idx_users_google_id' },
        ],
      });
    })().catch((error) => {
      ensureGoogleAuthSchemaPromise = null;
      throw error;
    });
  }

  await ensureGoogleAuthSchemaPromise;
}

export function buildTokenJti(payload: Pick<JwtPayload, 'sub' | 'iat'> & { jti?: string }): string {
  if (payload.jti) return payload.jti;
  return `${payload.sub}_${payload.iat ?? 0}`;
}

export async function isTokenBlacklisted(
  sql: SqlClient,
  payload: Pick<JwtPayload, 'sub' | 'iat'>,
): Promise<boolean> {
  const rows = await sql`
    SELECT 1
    FROM token_blacklist
    WHERE token_jti = ${buildTokenJti(payload)}
      AND expires_at > NOW()
  `;

  return rows.length > 0;
}

export async function getSafeUserById(sql: SqlClient, userId: string): Promise<SafeUser | null> {
  await ensureUserProfileSchema(sql);

  const rows = await sql`
    SELECT
      id,
      name,
      email,
      email_verified_at AS "emailVerifiedAt",
      avatar,
      state_code AS "stateCode",
      city_name AS "cityName",
      holiday_region_code AS "holidayRegionCode"
    FROM users
    WHERE id = ${userId}
  `;

  const user = (rows[0] as unknown as SafeUser | undefined) ?? null;
  if (!user) return null;

  user.currentOrganization = await ensurePersonalOrganization(sql, user);
  return user;
}

export async function requireAuthFromToken(
  sql: SqlClient,
  token: string,
  options?: { checkBlacklist?: boolean },
): Promise<{ payload: JwtPayload; user: SafeUser; token: string }> {
  let payload: JwtPayload;

  try {
    payload = verifyToken(token);
  } catch {
    throw new AuthError('INVALID_TOKEN');
  }

  if (options?.checkBlacklist !== false) {
    const blacklisted = await isTokenBlacklisted(sql, payload);
    if (blacklisted) throw new AuthError('TOKEN_BLACKLISTED');
  }

  const user = await getSafeUserById(sql, payload.sub);
  if (!user) throw new AuthError('USER_NOT_FOUND');

  return { payload, user, token };
}

export async function requireAuthFromAuthorizationHeader(
  sql: SqlClient,
  authHeader: string | undefined,
  options?: { checkBlacklist?: boolean },
): Promise<{ payload: JwtPayload; user: SafeUser; token: string }> {
  const token = extractBearerToken(authHeader);
  if (!token) throw new AuthError('MISSING_TOKEN');

  return requireAuthFromToken(sql, token, options);
}

export function getAuthFailureResponse(error: unknown): { status: number; error: string } | null {
  if (!(error instanceof AuthError)) return null;

  switch (error.code) {
    case 'MISSING_TOKEN':
      return { status: 401, error: 'Não autorizado' };
    case 'INVALID_TOKEN':
      return { status: 401, error: 'Token inválido ou expirado' };
    case 'TOKEN_BLACKLISTED':
      return { status: 401, error: 'Sessão encerrada. Faça login novamente.' };
    case 'USER_NOT_FOUND':
      return { status: 401, error: 'Usuário não encontrado' };
    default:
      return { status: 401, error: 'Não autorizado' };
  }
}
