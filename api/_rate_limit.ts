import sql from './_db.js';

const MAX_ATTEMPTS  = 10;
const WINDOW_MINUTES = 15;

/**
 * Verifica e registra uma tentativa de autenticação.
 * Retorna { allowed: true } ou { allowed: false, retryAfterSeconds: number }
 */
export async function checkRateLimit(
  ip: string,
  route: 'login' | 'register'
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  try {
    // Limpa registros antigos (> 1h) para manter a tabela enxuta
    await sql`
      DELETE FROM auth_rate_limit
      WHERE attempted_at < NOW() - INTERVAL '1 hour'
    `;

    // Conta tentativas na janela atual
    const countRows = await sql`
      SELECT COUNT(*)::int AS attempts,
             MIN(attempted_at) AS oldest
      FROM auth_rate_limit
      WHERE ip = ${ip}
        AND route = ${route}
        AND attempted_at >= ${windowStart}
    `;

    const attempts = countRows[0].attempts as number;
    const oldest   = countRows[0].oldest as string | null;

    if (attempts >= MAX_ATTEMPTS) {
      const resetAt = new Date(oldest!).getTime() + WINDOW_MINUTES * 60 * 1000;
      const retryAfterSeconds = Math.ceil((resetAt - Date.now()) / 1000);
      return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
    }

    // Registra a tentativa atual
    await sql`
      INSERT INTO auth_rate_limit (ip, route)
      VALUES (${ip}, ${route})
    `;

    return { allowed: true };
  } catch (e: any) {
    // Em caso de erro no banco, deixa passar (fail-open)
    // para não bloquear usuários legítimos por falha de infra
    console.error('[rate_limit]', e.message);
    return { allowed: true };
  }
}

/**
 * Remove as tentativas de um IP após login bem-sucedido.
 */
export async function clearRateLimit(ip: string, route: 'login' | 'register'): Promise<void> {
  try {
    await sql`
      DELETE FROM auth_rate_limit
      WHERE ip = ${ip} AND route = ${route}
    `;
  } catch (e: any) {
    console.error('[rate_limit:clear]', e.message);
  }
}
