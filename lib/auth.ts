import { extractBearerToken, verifyToken, type JwtPayload } from './jwt.js';

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
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

export function buildTokenJti(payload: Pick<JwtPayload, 'sub' | 'iat'>): string {
  return `${payload.sub}_${payload.iat ?? 0}`;
}

export async function isTokenBlacklisted(
  sql: any,
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

export async function getSafeUserById(sql: any, userId: string): Promise<SafeUser | null> {
  const rows = await sql`
    SELECT id, name, email, avatar
    FROM users
    WHERE id = ${userId}
  `;

  return (rows[0] as SafeUser | undefined) ?? null;
}

export async function requireAuthFromToken(
  sql: any,
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
  sql: any,
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
