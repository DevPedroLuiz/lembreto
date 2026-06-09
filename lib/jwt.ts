import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
export const CALENDAR_FEED_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

if (!SECRET) {
  throw new Error(
    '❌ JWT_SECRET não definida nas variáveis de ambiente.\n' +
    'Adicione JWT_SECRET=<string-longa-aleatória> no .env.local e no painel da Vercel.'
  );
}

export interface JwtPayload {
  sub: string;   // user id
  email: string;
  jti?: string;
  iat?: number;
  exp?: number;
}

export interface CalendarFeedJwtPayload {
  sub: string;
  email: string;
  fid: string;
  jti: string;
  scope: 'calendar-feed';
  iat?: number;
  exp?: number;
}

export interface CalendarOAuthStateJwtPayload {
  sub: string;
  organizationId?: string;
  provider: 'google' | 'outlook';
  nonce: string;
  scope: 'calendar-oauth';
  iat?: number;
  exp?: number;
}

/** Gera um JWT assinado válido por 7 dias. */
export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const { jti, ...claims } = payload;
  return jwt.sign(
    claims,
    SECRET as string,
    { expiresIn: '7d', ...(jti ? { jwtid: jti } : {}) },
  );
}

/** Verifica e decodifica o token. Lança erro se inválido ou expirado. */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET as string) as JwtPayload;
}

export function signCalendarFeedToken(payload: Omit<CalendarFeedJwtPayload, 'iat' | 'exp' | 'scope'>): string {
  const { jti, ...claims } = payload;
  return jwt.sign(
    { ...claims, scope: 'calendar-feed' },
    SECRET as string,
    { expiresIn: CALENDAR_FEED_TOKEN_TTL_SECONDS, jwtid: jti },
  );
}

export function verifyCalendarFeedToken(token: string): CalendarFeedJwtPayload {
  const payload = jwt.verify(token, SECRET as string) as CalendarFeedJwtPayload;
  if (payload.scope !== 'calendar-feed') {
    throw new Error('Invalid calendar feed token scope');
  }
  if (!payload.fid || !payload.jti) {
    throw new Error('Invalid calendar feed token identifiers');
  }

  return payload;
}

export function signCalendarOAuthState(payload: Omit<CalendarOAuthStateJwtPayload, 'iat' | 'exp' | 'scope'>): string {
  return jwt.sign({ ...payload, scope: 'calendar-oauth' }, SECRET as string, { expiresIn: '10m' });
}

export function verifyCalendarOAuthState(token: string): CalendarOAuthStateJwtPayload {
  const payload = jwt.verify(token, SECRET as string) as CalendarOAuthStateJwtPayload;
  if (payload.scope !== 'calendar-oauth') {
    throw new Error('Invalid calendar OAuth state scope');
  }

  return payload;
}

/** Extrai o token do header Authorization: Bearer <token> */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}
