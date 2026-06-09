import type { SqlClient } from './handlers/core.js';

async function getPlanLimit(sql: SqlClient, organizationId: string, key: string) {
  const rows = await sql`
    SELECT plans.limits ->> ${key} AS value
    FROM subscriptions
    INNER JOIN plans ON plans.code = subscriptions.plan_code
    WHERE subscriptions.organization_id = ${organizationId}
      AND subscriptions.status IN ('trialing', 'active', 'past_due')
    ORDER BY subscriptions.created_at DESC
    LIMIT 1
  `;

  const rawValue = rows[0]?.value;
  if (typeof rawValue !== 'string') return null;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function ensurePlanLimitAvailable(
  sql: SqlClient,
  input: {
    organizationId: string;
    limitKey: string;
    increment?: number;
    currentUsageQuery: (sql: SqlClient) => Promise<number>;
  },
) {
  const limit = await getPlanLimit(sql, input.organizationId, input.limitKey);
  if (limit === null || limit < 0) return { allowed: true, limit, usage: null };

  const usage = await input.currentUsageQuery(sql);
  const increment = input.increment ?? 1;
  return {
    allowed: usage + increment <= limit,
    limit,
    usage,
  };
}
