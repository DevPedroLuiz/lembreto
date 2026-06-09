CREATE TABLE IF NOT EXISTS plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('free', 'pro', 'team', 'enterprise')),
  limits JSONB NOT NULL DEFAULT '{}'::JSONB,
  features JSONB NOT NULL DEFAULT '{}'::JSONB,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO plans (code, name, tier, limits, features)
VALUES
  (
    'free',
    'Free',
    'free',
    '{"tasks":100,"members":1,"calendar_integrations":1,"ai_messages_per_month":25}'::JSONB,
    '{"team":false,"native_push":false,"priority_support":false}'::JSONB
  ),
  (
    'pro',
    'Pro',
    'pro',
    '{"tasks":-1,"members":1,"calendar_integrations":3,"ai_messages_per_month":500}'::JSONB,
    '{"team":false,"native_push":true,"priority_support":false}'::JSONB
  ),
  (
    'team',
    'Team',
    'team',
    '{"tasks":-1,"members":10,"calendar_integrations":10,"ai_messages_per_month":2000}'::JSONB,
    '{"team":true,"native_push":true,"priority_support":true}'::JSONB
  )
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  tier = EXCLUDED.tier,
  limits = EXCLUDED.limits,
  features = EXCLUDED.features,
  active = TRUE,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'team')),
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_personal_owner
  ON organizations(owner_user_id)
  WHERE type = 'personal' AND owner_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user
  ON organization_members(user_id, status);

CREATE INDEX IF NOT EXISTS idx_organization_members_org_role
  ON organization_members(organization_id, role);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES plans(code),
  provider TEXT NOT NULL DEFAULT 'internal' CHECK (provider IN ('internal', 'stripe', 'mercado_pago', 'pagarme')),
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_subscription
  ON subscriptions(provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_org_status
  ON subscriptions(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_org_type_time
  ON usage_events(organization_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_time
  ON usage_events(user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

WITH personal_organizations AS (
  INSERT INTO organizations (name, slug, type, owner_user_id)
  SELECT
    COALESCE(NULLIF(TRIM(name), ''), 'Usuario') || ' workspace',
    'personal-' || id::TEXT,
    'personal',
    id
  FROM users
  WHERE TRUE
  ON CONFLICT (slug) DO UPDATE
  SET
    owner_user_id = COALESCE(organizations.owner_user_id, EXCLUDED.owner_user_id),
    updated_at = NOW()
  RETURNING id, owner_user_id
)
INSERT INTO organization_members (organization_id, user_id, role, status)
SELECT id, owner_user_id, 'owner', 'active'
FROM personal_organizations
WHERE owner_user_id IS NOT NULL
ON CONFLICT (organization_id, user_id) DO UPDATE
SET role = 'owner', status = 'active', updated_at = NOW();

INSERT INTO subscriptions (organization_id, plan_code, provider, status)
SELECT organizations.id, 'free', 'internal', 'active'
FROM organizations
WHERE NOT EXISTS (
  SELECT 1
  FROM subscriptions
  WHERE subscriptions.organization_id = organizations.id
    AND subscriptions.provider = 'internal'
)
ON CONFLICT DO NOTHING;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE notification_schedules ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE task_side_effects ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE calendar_integrations ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE calendar_feeds ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE user_categories ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE user_tags ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE assistant_conversations ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE assistant_action_events ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE assistant_context_refs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE tasks
SET organization_id = organizations.id
FROM organizations
WHERE tasks.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = tasks.user_id;

UPDATE notes
SET organization_id = organizations.id
FROM organizations
WHERE notes.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = notes.user_id;

UPDATE notifications
SET organization_id = organizations.id
FROM organizations
WHERE notifications.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = notifications.user_id;

UPDATE notification_schedules
SET organization_id = organizations.id
FROM organizations
WHERE notification_schedules.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = notification_schedules.user_id;

UPDATE task_side_effects
SET organization_id = organizations.id
FROM organizations
WHERE task_side_effects.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = task_side_effects.user_id;

UPDATE calendar_integrations
SET organization_id = organizations.id
FROM organizations
WHERE calendar_integrations.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = calendar_integrations.user_id;

UPDATE calendar_feeds
SET organization_id = organizations.id
FROM organizations
WHERE calendar_feeds.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = calendar_feeds.user_id;

UPDATE user_categories
SET organization_id = organizations.id
FROM organizations
WHERE user_categories.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = user_categories.user_id;

UPDATE user_tags
SET organization_id = organizations.id
FROM organizations
WHERE user_tags.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = user_tags.user_id;

UPDATE assistant_conversations
SET organization_id = organizations.id
FROM organizations
WHERE assistant_conversations.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = assistant_conversations.user_id;

UPDATE assistant_messages
SET organization_id = organizations.id
FROM organizations
WHERE assistant_messages.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = assistant_messages.user_id;

UPDATE assistant_action_events
SET organization_id = organizations.id
FROM organizations
WHERE assistant_action_events.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = assistant_action_events.user_id;

UPDATE assistant_context_refs
SET organization_id = organizations.id
FROM organizations
WHERE assistant_context_refs.organization_id IS NULL
  AND organizations.type = 'personal'
  AND organizations.owner_user_id = assistant_context_refs.user_id;

CREATE INDEX IF NOT EXISTS idx_tasks_organization_created
  ON tasks(organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notes_organization_created
  ON notes(organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_organization_created
  ON notifications(organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_schedules_organization_due
  ON notification_schedules(organization_id, status, notify_at)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_side_effects_organization_due
  ON task_side_effects(organization_id, status, available_at)
  WHERE organization_id IS NOT NULL;
