DROP INDEX IF EXISTS idx_calendar_integrations_user_provider;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_integrations_org_user_provider
  ON calendar_integrations(organization_id, user_id, provider)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_integrations_user_provider_legacy
  ON calendar_integrations(user_id, provider)
  WHERE organization_id IS NULL;
