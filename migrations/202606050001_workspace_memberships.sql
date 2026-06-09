ALTER TABLE users
ADD COLUMN IF NOT EXISTS current_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE users
SET current_organization_id = organizations.id
FROM organizations
WHERE users.current_organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = users.id;

CREATE INDEX IF NOT EXISTS idx_users_current_organization
  ON users(current_organization_id)
  WHERE current_organization_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organization_invitations_org_status
  ON organization_invitations(organization_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_invitations_pending_email
  ON organization_invitations(organization_id, LOWER(email))
  WHERE status = 'pending';
