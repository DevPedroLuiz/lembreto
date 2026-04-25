const COOKIE_NAME = 'lembreto_session';

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

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${
    isProduction() ? '; Secure' : ''
  }`;
}

export function getSessionTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  const raw = cookieHeader ?? '';

  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === COOKIE_NAME) return rest.join('=') || null;
  }

  return null;
}
