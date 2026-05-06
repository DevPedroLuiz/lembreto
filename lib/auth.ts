import { extractBearerToken, verifyToken, type JwtPayload } from './jwt.js';
import type { SqlClient } from './handlers/core.js';

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  stateCode?: string | null;
  cityName?: string | null;
  holidayRegionCode?: string | null;
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

export async function ensureUserProfileSchema(sql: SqlClient) {
  if (!ensureUserProfileSchemaPromise) {
    ensureUserProfileSchemaPromise = (async () => {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS state_code TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS city_name TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS holiday_region_code TEXT`;
    })();
  }

  await ensureUserProfileSchemaPromise;
}

export async function ensureGoogleAuthSchema(sql: SqlClient) {
  if (!ensureGoogleAuthSchemaPromise) {
    ensureGoogleAuthSchemaPromise = (async () => {
      await ensureUserProfileSchema(sql);
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL`;
    })();
  }

  await ensureGoogleAuthSchemaPromise;
}

export function buildTokenJti(payload: Pick<JwtPayload, 'sub' | 'iat'>): string {
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
      avatar,
      state_code AS "stateCode",
      city_name AS "cityName",
      holiday_region_code AS "holidayRegionCode"
    FROM users
    WHERE id = ${userId}
  `;

  return (rows[0] as unknown as SafeUser | undefined) ?? null;
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
