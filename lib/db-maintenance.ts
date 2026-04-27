import type { SqlClient } from './handlers/core.js';

export async function cleanupDatabase(sql: SqlClient) {
  const [blacklist, rateLimit, resetTokens] = await Promise.all([
    sql`DELETE FROM token_blacklist WHERE expires_at < NOW() RETURNING token_jti`,
    sql`DELETE FROM auth_rate_limit WHERE attempted_at < NOW() - INTERVAL '1 hour' RETURNING id`,
    sql`DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used = TRUE RETURNING id`,
  ]);

  return {
    tokenBlacklistRows: blacklist.length,
    authRateLimitRows: rateLimit.length,
    passwordResetRows: resetTokens.length,
  };
}
