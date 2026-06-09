import { assertInfrastructure } from './infrastructure.js';
import type { SqlClient } from './handlers/core.js';

export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer';
export type OrganizationType = 'personal' | 'team';

export interface CurrentOrganization {
  id: string;
  name: string;
  slug: string;
  type: OrganizationType;
  role: OrganizationRole;
  planCode: string;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  type: OrganizationType;
  role: OrganizationRole;
  planCode: string | null;
}

let ensureSaasInfrastructurePromise: Promise<void> | null = null;

export async function ensureSaasInfrastructure(sql: SqlClient) {
  if (!ensureSaasInfrastructurePromise) {
    ensureSaasInfrastructurePromise = assertInfrastructure(sql, 'saas organizations', {
      relations: [
        { name: 'organizations' },
        { name: 'organization_members' },
        { name: 'plans' },
        { name: 'subscriptions' },
        { name: 'usage_events' },
        { name: 'organization_invitations' },
      ],
      columns: [
        { table: 'users', column: 'current_organization_id' },
        { table: 'organizations', column: 'owner_user_id' },
        { table: 'organization_members', column: 'role' },
        { table: 'organization_invitations', column: 'token_hash' },
        { table: 'subscriptions', column: 'plan_code' },
        { table: 'tasks', column: 'organization_id' },
        { table: 'notes', column: 'organization_id' },
      ],
      indexes: [
        { name: 'idx_organization_members_user' },
        { name: 'idx_subscriptions_org_status' },
      ],
    }).catch((error) => {
      ensureSaasInfrastructurePromise = null;
      throw error;
    });
  }

  await ensureSaasInfrastructurePromise;
}

function buildPersonalOrganizationName(name: string) {
  const normalized = name.trim();
  return normalized ? `${normalized} workspace` : 'Meu workspace';
}

function mapOrganization(row: OrganizationRow): CurrentOrganization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    type: row.type,
    role: row.role,
    planCode: row.planCode ?? 'free',
  };
}

export async function ensurePersonalOrganization(
  sql: SqlClient,
  user: { id: string; name: string },
): Promise<CurrentOrganization> {
  await ensureSaasInfrastructure(sql);

  const rows = await sql`
    WITH organization_row AS (
      INSERT INTO organizations (name, slug, type, owner_user_id)
      VALUES (${buildPersonalOrganizationName(user.name)}, ${`personal-${user.id}`}, 'personal', ${user.id})
      ON CONFLICT (slug) DO UPDATE
      SET
        owner_user_id = COALESCE(organizations.owner_user_id, EXCLUDED.owner_user_id),
        updated_at = NOW()
      RETURNING id, name, slug, type
    ),
    membership_row AS (
      INSERT INTO organization_members (organization_id, user_id, role, status)
      SELECT id, ${user.id}, 'owner', 'active'
      FROM organization_row
      WHERE TRUE
      ON CONFLICT (organization_id, user_id) DO UPDATE
      SET role = 'owner', status = 'active', updated_at = NOW()
      RETURNING organization_id, role
    ),
    current_user_row AS (
      UPDATE users
      SET current_organization_id = COALESCE(current_organization_id, (SELECT id FROM organization_row))
      WHERE id = ${user.id}
      RETURNING id
    ),
    subscription_row AS (
      INSERT INTO subscriptions (organization_id, plan_code, provider, status)
      SELECT id, 'free', 'internal', 'active'
      FROM organization_row
      WHERE NOT EXISTS (
        SELECT 1
        FROM subscriptions
        WHERE subscriptions.organization_id = organization_row.id
          AND subscriptions.provider = 'internal'
      )
      RETURNING organization_id, plan_code
    )
    SELECT
      organization_row.id,
      organization_row.name,
      organization_row.slug,
      organization_row.type,
      membership_row.role,
      COALESCE(
        subscription_row.plan_code,
        (
          SELECT plan_code
          FROM subscriptions
          WHERE subscriptions.organization_id = organization_row.id
          ORDER BY created_at DESC
          LIMIT 1
        ),
        'free'
      ) AS "planCode"
    FROM organization_row
    INNER JOIN membership_row ON membership_row.organization_id = organization_row.id
  `;

  return mapOrganization(rows[0] as unknown as OrganizationRow);
}

export async function getCurrentOrganizationForUser(
  sql: SqlClient,
  userId: string,
): Promise<CurrentOrganization | null> {
  await ensureSaasInfrastructure(sql);

  const rows = await sql`
    SELECT
      organizations.id,
      organizations.name,
      organizations.slug,
      organizations.type,
      organization_members.role,
      COALESCE(
        (
          SELECT plan_code
          FROM subscriptions
          WHERE subscriptions.organization_id = organizations.id
            AND subscriptions.status IN ('trialing', 'active', 'past_due')
          ORDER BY created_at DESC
          LIMIT 1
        ),
        'free'
      ) AS "planCode"
    FROM organization_members
    INNER JOIN organizations ON organizations.id = organization_members.organization_id
    LEFT JOIN users ON users.id = organization_members.user_id
    WHERE organization_members.user_id = ${userId}
      AND organization_members.status = 'active'
    ORDER BY
      CASE WHEN users.current_organization_id = organizations.id THEN 0 ELSE 1 END,
      CASE WHEN organizations.type = 'personal' THEN 0 ELSE 1 END,
      organization_members.created_at ASC
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return mapOrganization(rows[0] as unknown as OrganizationRow);
}

export async function requireCurrentOrganization(
  sql: SqlClient,
  user: { id: string; name: string; currentOrganization?: CurrentOrganization | null },
): Promise<CurrentOrganization> {
  if (user.currentOrganization) return user.currentOrganization;
  return ensurePersonalOrganization(sql, user);
}
