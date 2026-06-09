import { createHash, randomBytes } from 'node:crypto';
import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../auth.js';
import { logError, logInfo } from '../logger.js';
import { ensureSaasInfrastructure, requireCurrentOrganization, type CurrentOrganization } from '../organizations.js';
import { ensurePlanLimitAvailable } from '../plan-limits.js';
import {
  acceptOrganizationInviteSchema,
  createOrganizationInviteSchema,
  formatZodError,
  removeOrganizationMemberSchema,
  revokeOrganizationInviteSchema,
  switchOrganizationSchema,
  updateOrganizationMemberSchema,
  updateOrganizationSchema,
} from '../schemas.js';
import {
  type HandlerContext,
  type HandlerResult,
  getRequestMeta,
  json,
  methodNotAllowed,
} from './core.js';

type OrganizationMemberRole = 'owner' | 'admin' | 'member' | 'viewer';
type OrganizationMemberStatus = 'active' | 'invited' | 'suspended';

interface OrganizationMemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  role: OrganizationMemberRole;
  status: OrganizationMemberStatus;
  createdAt: string;
}

interface OrganizationInvitationRow {
  id: string;
  email: string;
  role: Exclude<OrganizationMemberRole, 'owner'>;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  invitedByName: string | null;
}

interface PlanRow {
  code: string;
  name: string;
  tier: string;
  limits: Record<string, unknown>;
  features: Record<string, unknown>;
}

async function requireOrganizationAuth(context: HandlerContext) {
  try {
    return await requireAuthFromAuthorizationHeader(
      context.sql,
      context.request.headers.authorization as string | undefined,
    );
  } catch (error) {
    const authFailure = getAuthFailureResponse(error);
    if (authFailure) return json(authFailure.status, { error: authFailure.error });

    logError('organization_auth_failed', error, getRequestMeta(context.request));
    return json(500, { error: 'Erro interno ao autenticar' });
  }
}

function canManageWorkspace(role: string) {
  return role === 'owner' || role === 'admin';
}

function firstQueryValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function hashInviteToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function buildInviteUrl(context: HandlerContext, token: string) {
  const originHeader = context.request.headers.origin;
  const hostHeader = context.request.headers.host;
  const baseUrl = typeof originHeader === 'string'
    ? originHeader
    : context.defaultAppUrl
      ?? (typeof hostHeader === 'string' ? `http://${hostHeader}` : '');
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}/?invite=${encodeURIComponent(token)}` : null;
}

async function getActiveOrganizationForPayload(context: HandlerContext, user: { id: string; name: string }) {
  return requireCurrentOrganization(context.sql, { ...user, currentOrganization: null });
}

async function countOccupiedMemberSeats(
  sql: HandlerContext['sql'],
  organizationId: string,
  options: { excludePendingInvitationEmail?: string | null } = {},
) {
  const rows = await sql`
    SELECT
      (
        SELECT COUNT(*)
        FROM organization_members
        WHERE organization_id = ${organizationId}
          AND status = 'active'
      ) +
      (
        SELECT COUNT(*)
        FROM organization_invitations
        WHERE organization_id = ${organizationId}
          AND status = 'pending'
          AND (${options.excludePendingInvitationEmail ?? null}::text IS NULL OR LOWER(email) <> ${options.excludePendingInvitationEmail ?? null})
      ) AS count
  `;

  return Number(rows[0]?.count ?? 0);
}

async function ensureMemberSeatAvailable(
  sql: HandlerContext['sql'],
  organizationId: string,
  options: { excludePendingInvitationEmail?: string | null } = {},
) {
  const result = await ensurePlanLimitAvailable(sql, {
    organizationId,
    limitKey: 'members',
    increment: 1,
    currentUsageQuery: (clientSql) => countOccupiedMemberSeats(clientSql, organizationId, options),
  });

  if (!result.allowed) {
    const usage = result.usage ?? 0;
    const limit = result.limit ?? 0;
    return json(403, {
      error: `Limite de membros do plano atingido (${usage}/${limit}).`,
    });
  }

  return null;
}

async function buildOrganizationPayload(context: HandlerContext, user: { id: string; name: string }) {
  const { sql } = context;
  await ensureSaasInfrastructure(sql);
  const organization = await getActiveOrganizationForPayload(context, user);
  const organizationId = organization.id;

  const [workspaceRows, memberRows, invitationRows, planRows, taskCountRows, noteCountRows, integrationCountRows] = await Promise.all([
    sql`
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
      WHERE organization_members.user_id = ${user.id}
        AND organization_members.status = 'active'
      ORDER BY
        CASE WHEN organizations.id = ${organizationId} THEN 0 ELSE 1 END,
        CASE WHEN organizations.type = 'personal' THEN 0 ELSE 1 END,
        organization_members.created_at ASC
    `,
    sql`
      SELECT
        organization_members.id,
        users.id AS "userId",
        users.name,
        users.email,
        users.avatar,
        organization_members.role,
        organization_members.status,
        organization_members.created_at AS "createdAt"
      FROM organization_members
      INNER JOIN users ON users.id = organization_members.user_id
      WHERE organization_members.organization_id = ${organizationId}
      ORDER BY
        CASE organization_members.role
          WHEN 'owner' THEN 0
          WHEN 'admin' THEN 1
          WHEN 'member' THEN 2
          ELSE 3
        END,
        organization_members.created_at ASC
    `,
    sql`
      SELECT
        organization_invitations.id,
        organization_invitations.email,
        organization_invitations.role,
        organization_invitations.status,
        organization_invitations.expires_at AS "expiresAt",
        organization_invitations.created_at AS "createdAt",
        users.name AS "invitedByName"
      FROM organization_invitations
      LEFT JOIN users ON users.id = organization_invitations.invited_by
      WHERE organization_invitations.organization_id = ${organizationId}
        AND organization_invitations.status = 'pending'
      ORDER BY organization_invitations.created_at DESC
    `,
    sql`
      SELECT
        plans.code,
        plans.name,
        plans.tier,
        plans.limits,
        plans.features
      FROM plans
      WHERE plans.code = ${organization.planCode}
      LIMIT 1
    `,
    sql`
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE organization_id = ${organizationId}
        AND deleted_at IS NULL
    `,
    sql`
      SELECT COUNT(*) AS count
      FROM notes
      WHERE organization_id = ${organizationId}
        AND deleted_at IS NULL
    `,
    sql`
      SELECT COUNT(*) AS count
      FROM calendar_integrations
      WHERE organization_id = ${organizationId}
    `,
  ]);

  const fallbackPlan: PlanRow = {
    code: organization.planCode,
    name: organization.planCode.toUpperCase(),
    tier: organization.planCode,
    limits: {},
    features: {},
  };
  const plan = (planRows[0] as unknown as PlanRow | undefined) ?? fallbackPlan;

  return {
    organization,
    workspaces: workspaceRows as unknown as CurrentOrganization[],
    members: memberRows as unknown as OrganizationMemberRow[],
    invitations: invitationRows as unknown as OrganizationInvitationRow[],
    plan,
    usage: {
      tasks: Number(taskCountRows[0]?.count ?? 0),
      notes: Number(noteCountRows[0]?.count ?? 0),
      calendarIntegrations: Number(integrationCountRows[0]?.count ?? 0),
      members: memberRows.filter((row) => row.status === 'active').length,
    },
    permissions: {
      canManageWorkspace: canManageWorkspace(organization.role),
      canManageMembers: organization.role === 'owner' || organization.role === 'admin',
      canManageBilling: organization.role === 'owner',
    },
  };
}

async function handleSwitchWorkspace(context: HandlerContext, user: { id: string; name: string }) {
  const parsed = switchOrganizationSchema.safeParse(context.request.body ?? {});
  if (!parsed.success) return json(400, { error: formatZodError(parsed.error) });

  const rows = await context.sql`
    SELECT id
    FROM organization_members
    WHERE organization_id = ${parsed.data.organizationId}
      AND user_id = ${user.id}
      AND status = 'active'
    LIMIT 1
  `;
  if (rows.length === 0) return json(404, { error: 'Workspace nao encontrado para este usuario.' });

  await context.sql`
    UPDATE users
    SET current_organization_id = ${parsed.data.organizationId}
    WHERE id = ${user.id}
  `;

  const payload = await buildOrganizationPayload(context, user);
  logInfo('organization_switched', getRequestMeta(context.request, {
    userId: user.id,
    organizationId: parsed.data.organizationId,
  }));
  return json(200, payload);
}

async function handleCreateInvite(context: HandlerContext, user: { id: string; name: string }) {
  const parsed = createOrganizationInviteSchema.safeParse(context.request.body ?? {});
  if (!parsed.success) return json(400, { error: formatZodError(parsed.error) });

  const organization = await getActiveOrganizationForPayload(context, user);
  if (organization.role !== 'owner' && organization.role !== 'admin') {
    return json(403, { error: 'Seu papel nao permite convidar membros.' });
  }

  const email = parsed.data.email.toLocaleLowerCase('pt-BR');
  const existingMember = await context.sql`
    SELECT organization_members.id
    FROM organization_members
    INNER JOIN users ON users.id = organization_members.user_id
    WHERE organization_members.organization_id = ${organization.id}
      AND LOWER(users.email) = ${email}
      AND organization_members.status = 'active'
    LIMIT 1
  `;
  if (existingMember.length > 0) {
    return json(409, { error: 'Este usuario ja faz parte do workspace.' });
  }

  const memberLimitError = await ensureMemberSeatAvailable(context.sql, organization.id, {
    excludePendingInvitationEmail: email,
  });
  if (memberLimitError) return memberLimitError;

  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashInviteToken(token);
  await context.sql`
    INSERT INTO organization_invitations (organization_id, email, role, token_hash, status, invited_by, expires_at)
    VALUES (${organization.id}, ${email}, ${parsed.data.role}, ${tokenHash}, 'pending', ${user.id}, NOW() + INTERVAL '7 days')
    ON CONFLICT (organization_id, LOWER(email)) WHERE status = 'pending'
    DO UPDATE SET
      role = EXCLUDED.role,
      token_hash = EXCLUDED.token_hash,
      invited_by = EXCLUDED.invited_by,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
  `;

  const nextPayload = await buildOrganizationPayload(context, user);
  logInfo('organization_invite_created', getRequestMeta(context.request, {
    userId: user.id,
    organizationId: organization.id,
    email,
  }));
  return json(201, {
    ...nextPayload,
    invitationToken: token,
    invitationUrl: buildInviteUrl(context, token),
  });
}

async function handleAcceptInvite(context: HandlerContext, user: { id: string; name: string; email: string }) {
  const parsed = acceptOrganizationInviteSchema.safeParse(context.request.body ?? {});
  if (!parsed.success) return json(400, { error: formatZodError(parsed.error) });

  const tokenHash = hashInviteToken(parsed.data.token);
  const rows = await context.sql`
    SELECT
      id,
      organization_id AS "organizationId",
      email,
      role,
      status,
      expires_at AS "expiresAt"
    FROM organization_invitations
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `;
  const invitation = rows[0] as undefined | {
    id: string;
    organizationId: string;
    email: string;
    role: Exclude<OrganizationMemberRole, 'owner'>;
    status: string;
    expiresAt: string;
  };
  if (!invitation || invitation.status !== 'pending') {
    return json(404, { error: 'Convite nao encontrado ou ja utilizado.' });
  }
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
    await context.sql`
      UPDATE organization_invitations
      SET status = 'expired', updated_at = NOW()
      WHERE id = ${invitation.id}
    `;
    return json(410, { error: 'Convite expirado.' });
  }
  if (invitation.email.toLocaleLowerCase('pt-BR') !== user.email.toLocaleLowerCase('pt-BR')) {
    return json(403, { error: 'Este convite pertence a outro e-mail.' });
  }

  const acceptInvite = async (transaction: typeof context.sql) => {
    const existingMembership = await transaction`
      SELECT id
      FROM organization_members
      WHERE organization_id = ${invitation.organizationId}
        AND user_id = ${user.id}
        AND status = 'active'
      LIMIT 1
    `;

    if (existingMembership.length === 0) {
      const memberLimitError = await ensureMemberSeatAvailable(transaction, invitation.organizationId, {
        excludePendingInvitationEmail: invitation.email.toLocaleLowerCase('pt-BR'),
      });
      if (memberLimitError) {
        throw Object.assign(new Error('member_limit_reached'), { response: memberLimitError });
      }
    }

    await transaction`
      INSERT INTO organization_members (organization_id, user_id, role, status)
      VALUES (${invitation.organizationId}, ${user.id}, ${invitation.role}, 'active')
      ON CONFLICT (organization_id, user_id) DO UPDATE
      SET role = EXCLUDED.role, status = 'active', updated_at = NOW()
    `;
    await transaction`
      UPDATE organization_invitations
      SET status = 'accepted', accepted_by = ${user.id}, accepted_at = NOW(), updated_at = NOW()
      WHERE id = ${invitation.id}
    `;
    await transaction`
      UPDATE users
      SET current_organization_id = ${invitation.organizationId}
      WHERE id = ${user.id}
    `;
  };

  if (context.sql.begin) {
    try {
      await context.sql.begin(acceptInvite);
    } catch (error) {
      const response = (error as { response?: HandlerResult }).response;
      if (response) return response;
      throw error;
    }
  } else {
    try {
      await acceptInvite(context.sql);
    } catch (error) {
      const response = (error as { response?: HandlerResult }).response;
      if (response) return response;
      throw error;
    }
  }

  const payload = await buildOrganizationPayload(context, user);
  logInfo('organization_invite_accepted', getRequestMeta(context.request, {
    userId: user.id,
    organizationId: invitation.organizationId,
  }));
  return json(200, payload);
}

async function handleUpdateMember(context: HandlerContext, user: { id: string; name: string }) {
  const parsed = updateOrganizationMemberSchema.safeParse(context.request.body ?? {});
  if (!parsed.success) return json(400, { error: formatZodError(parsed.error) });

  const organization = await getActiveOrganizationForPayload(context, user);
  if (organization.role !== 'owner' && organization.role !== 'admin') {
    return json(403, { error: 'Seu papel nao permite alterar membros.' });
  }
  if (organization.role !== 'owner' && parsed.data.role === 'admin') {
    return json(403, { error: 'Apenas proprietarios podem promover administradores.' });
  }

  const rows = await context.sql`
    SELECT id, user_id AS "userId", role
    FROM organization_members
    WHERE id = ${parsed.data.memberId}
      AND organization_id = ${organization.id}
      AND status = 'active'
    LIMIT 1
  `;
  const member = rows[0] as undefined | { id: string; userId: string; role: OrganizationMemberRole };
  if (!member) return json(404, { error: 'Membro nao encontrado.' });
  if (member.role === 'owner') return json(403, { error: 'O proprietario nao pode ter o papel alterado por aqui.' });
  if (member.userId === user.id) return json(403, { error: 'Voce nao pode alterar seu proprio papel.' });

  await context.sql`
    UPDATE organization_members
    SET role = ${parsed.data.role}, updated_at = NOW()
    WHERE id = ${parsed.data.memberId}
      AND organization_id = ${organization.id}
  `;

  const payload = await buildOrganizationPayload(context, user);
  logInfo('organization_member_updated', getRequestMeta(context.request, {
    userId: user.id,
    organizationId: organization.id,
    memberId: parsed.data.memberId,
  }));
  return json(200, payload);
}

async function handleRemoveMember(context: HandlerContext, user: { id: string; name: string }) {
  const parsed = removeOrganizationMemberSchema.safeParse(context.request.body ?? {});
  if (!parsed.success) return json(400, { error: formatZodError(parsed.error) });

  const organization = await getActiveOrganizationForPayload(context, user);
  if (organization.role !== 'owner' && organization.role !== 'admin') {
    return json(403, { error: 'Seu papel nao permite remover membros.' });
  }

  const rows = await context.sql`
    SELECT id, user_id AS "userId", role
    FROM organization_members
    WHERE id = ${parsed.data.memberId}
      AND organization_id = ${organization.id}
      AND status = 'active'
    LIMIT 1
  `;
  const member = rows[0] as undefined | { id: string; userId: string; role: OrganizationMemberRole };
  if (!member) return json(404, { error: 'Membro nao encontrado.' });
  if (member.role === 'owner') return json(403, { error: 'O proprietario nao pode ser removido.' });
  if (member.userId === user.id) return json(403, { error: 'Use troca de workspace antes de sair deste ambiente.' });

  await context.sql`
    DELETE FROM organization_members
    WHERE id = ${parsed.data.memberId}
      AND organization_id = ${organization.id}
  `;

  const payload = await buildOrganizationPayload(context, user);
  logInfo('organization_member_removed', getRequestMeta(context.request, {
    userId: user.id,
    organizationId: organization.id,
    memberId: parsed.data.memberId,
  }));
  return json(200, payload);
}

async function handleRevokeInvite(context: HandlerContext, user: { id: string; name: string }) {
  const parsed = revokeOrganizationInviteSchema.safeParse(context.request.body ?? {});
  if (!parsed.success) return json(400, { error: formatZodError(parsed.error) });

  const organization = await getActiveOrganizationForPayload(context, user);
  if (organization.role !== 'owner' && organization.role !== 'admin') {
    return json(403, { error: 'Seu papel nao permite revogar convites.' });
  }

  const rows = await context.sql`
    UPDATE organization_invitations
    SET status = 'revoked', updated_at = NOW()
    WHERE id = ${parsed.data.invitationId}
      AND organization_id = ${organization.id}
      AND status = 'pending'
    RETURNING id
  `;
  if (rows.length === 0) return json(404, { error: 'Convite nao encontrado.' });

  const payload = await buildOrganizationPayload(context, user);
  logInfo('organization_invite_revoked', getRequestMeta(context.request, {
    userId: user.id,
    organizationId: organization.id,
    invitationId: parsed.data.invitationId,
  }));
  return json(200, payload);
}

export async function handleOrganization(context: HandlerContext): Promise<HandlerResult> {
  const auth = await requireOrganizationAuth(context);
  if ('status' in auth) return auth;

  const { request, sql } = context;
  const user = auth.user;
  const action = firstQueryValue(request.query?.action);

  if (request.method === 'GET') {
    try {
      const payload = await buildOrganizationPayload(context, user);
      return json(200, payload);
    } catch (error) {
      logError('organization_get_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao carregar workspace' });
    }
  }

  if (request.method === 'POST' && action === 'switch') {
    try {
      return await handleSwitchWorkspace(context, user);
    } catch (error) {
      logError('organization_switch_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao trocar workspace' });
    }
  }

  if (request.method === 'POST' && action === 'invite') {
    try {
      return await handleCreateInvite(context, user);
    } catch (error) {
      logError('organization_invite_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao criar convite' });
    }
  }

  if (request.method === 'POST' && action === 'accept-invite') {
    try {
      return await handleAcceptInvite(context, user);
    } catch (error) {
      logError('organization_accept_invite_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao aceitar convite' });
    }
  }

  if (request.method === 'PUT' && action === 'member') {
    try {
      return await handleUpdateMember(context, user);
    } catch (error) {
      logError('organization_member_update_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao atualizar membro' });
    }
  }

  if (request.method === 'DELETE' && action === 'member') {
    try {
      return await handleRemoveMember(context, user);
    } catch (error) {
      logError('organization_member_remove_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao remover membro' });
    }
  }

  if (request.method === 'DELETE' && action === 'invite') {
    try {
      return await handleRevokeInvite(context, user);
    } catch (error) {
      logError('organization_invite_revoke_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao revogar convite' });
    }
  }

  if (request.method === 'PUT' && !action) {
    const parsed = updateOrganizationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return json(400, { error: formatZodError(parsed.error) });
    }

    try {
      await ensureSaasInfrastructure(sql);
      const organization = await requireCurrentOrganization(sql, user);
      if (!canManageWorkspace(organization.role)) {
        return json(403, { error: 'Seu papel nÃ£o permite alterar este workspace.' });
      }

      await sql`
        UPDATE organizations
        SET name = ${parsed.data.name}, updated_at = NOW()
        WHERE id = ${organization.id}
      `;

      const payload = await buildOrganizationPayload(context, user);
      logInfo('organization_updated', getRequestMeta(request, {
        userId: user.id,
        organizationId: organization.id,
      }));
      return json(200, payload);
    } catch (error) {
      logError('organization_update_failed', error, getRequestMeta(request, { userId: user.id }));
      return json(500, { error: 'Erro ao atualizar workspace' });
    }
  }

  return methodNotAllowed();
}
