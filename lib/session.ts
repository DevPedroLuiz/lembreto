const COOKIE_NAME = 'lembreto_session';
const GOOGLE_OAUTH_STATE_COOKIE_NAME = 'lembreto_google_oauth_state';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ];

  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

export function buildGoogleOAuthStateCookie(state: string, maxAgeSeconds: number): string {
  const parts = [
    `${GOOGLE_OAUTH_STATE_COOKIE_NAME}=${state}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${
    isProduction() ? '; Secure' : ''
  }`;
}

export function clearGoogleOAuthStateCookie(): string {
  return `${GOOGLE_OAUTH_STATE_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${
    isProduction() ? '; Secure' : ''
  }`;
}

function getCookieFromHeader(cookieHeader: string | undefined, cookieName: string): string | null {
  const raw = cookieHeader ?? '';

  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === cookieName) return rest.join('=') || null;
  }

  return null;
}

export function getSessionTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  return getCookieFromHeader(cookieHeader, COOKIE_NAME);
}

export function getGoogleOAuthStateFromCookieHeader(cookieHeader: string | undefined): string | null {
  return getCookieFromHeader(cookieHeader, GOOGLE_OAUTH_STATE_COOKIE_NAME);
}
