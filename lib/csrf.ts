function normalizeHost(host: string | undefined): string | null {
  if (!host) return null;
  return host.trim().toLowerCase();
}

export function isTrustedRequestOrigin(headers: Record<string, string | string[] | undefined>): boolean {
  const secFetchSite = typeof headers['sec-fetch-site'] === 'string'
    ? headers['sec-fetch-site'].toLowerCase()
    : null;

  if (secFetchSite === 'cross-site') return false;

  const host = normalizeHost(
    (typeof headers['x-forwarded-host'] === 'string' && headers['x-forwarded-host']) ||
    (typeof headers.host === 'string' && headers.host) ||
    undefined,
  );

  if (!host) return true;

  const originHeader =
    (typeof headers.origin === 'string' && headers.origin) ||
    (typeof headers.referer === 'string' && headers.referer) ||
    null;

  if (!originHeader) return true;

  try {
    const url = new URL(originHeader);
    return normalizeHost(url.host) === host;
  } catch {
    return false;
  }
}
