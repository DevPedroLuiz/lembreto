import sql from './_db.js';

export type RateLimitRoute = 'login' | 'register' | 'recover' | 'bulk_create' | 'verify_email';

const DEFAULT_POLICY = { maxAttempts: 10, windowMinutes: 15, cleanupHours: 1 };
const ROUTE_POLICIES: Record<RateLimitRoute, typeof DEFAULT_POLICY> = {
  login: { maxAttempts: 6, windowMinutes: 15, cleanupHours: 2 },
  register: { maxAttempts: 5, windowMinutes: 30, cleanupHours: 2 },
  recover: { maxAttempts: 3, windowMinutes: 30, cleanupHours: 2 },
  bulk_create: { maxAttempts: 40, windowMinutes: 10, cleanupHours: 1 },
  verify_email: { maxAttempts: 5, windowMinutes: 30, cleanupHours: 2 },
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro desconhecido';
}

/**
 * Verifica e registra uma tentativa de autenticação.
 * Retorna { allowed: true } ou { allowed: false, retryAfterSeconds: number }.
 */
export async function checkRateLimit(
  ip: string,
  route: RateLimitRoute,
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const policy = ROUTE_POLICIES[route] ?? DEFAULT_POLICY;
  const windowStart = new Date(Date.now() - policy.windowMinutes * 60 * 1000).toISOString();

  try {
    await sql`
      DELETE FROM auth_rate_limit
      WHERE attempted_at < NOW() - (${policy.cleanupHours}::int * INTERVAL '1 hour')
    `;

    const countRows = await sql`
      SELECT COUNT(*)::int AS attempts,
             MIN(attempted_at) AS oldest
      FROM auth_rate_limit
      WHERE ip = ${ip}
        AND route = ${route}
        AND attempted_at >= ${windowStart}
    `;

    const attempts = countRows[0].attempts as number;
    const oldest = countRows[0].oldest as string | null;

    if (attempts >= policy.maxAttempts) {
      const resetAt = new Date(oldest!).getTime() + policy.windowMinutes * 60 * 1000;
      const retryAfterSeconds = Math.ceil((resetAt - Date.now()) / 1000);
      return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
    }

    await sql`
      INSERT INTO auth_rate_limit (ip, route)
      VALUES (${ip}, ${route})
    `;

    return { allowed: true };
  } catch (error: unknown) {
    console.error('[rate_limit]', getErrorMessage(error));
    return { allowed: true };
  }
}

/**
 * Remove as tentativas de um IP após login bem-sucedido.
 */
export async function clearRateLimit(ip: string, route: RateLimitRoute): Promise<void> {
  try {
    await sql`
      DELETE FROM auth_rate_limit
      WHERE ip = ${ip} AND route = ${route}
    `;
  } catch (error: unknown) {
    console.error('[rate_limit:clear]', getErrorMessage(error));
  }
}
