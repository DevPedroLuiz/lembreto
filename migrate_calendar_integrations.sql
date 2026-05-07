ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS external_calendar_provider TEXT CHECK (external_calendar_provider IN ('google', 'outlook'));

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS external_calendar_event_id TEXT;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS external_calendar_sync_status TEXT NOT NULL DEFAULT 'idle'
  CHECK (external_calendar_sync_status IN ('idle', 'synced', 'failed'));

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS external_calendar_last_error TEXT;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS external_calendar_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_external_calendar
  ON tasks(user_id, external_calendar_provider, external_calendar_event_id)
  WHERE external_calendar_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS calendar_integrations (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                TEXT        NOT NULL CHECK (provider IN ('google', 'outlook')),
  access_token_encrypted  TEXT        NOT NULL,
  refresh_token_encrypted TEXT        NOT NULL,
  expires_at              TIMESTAMPTZ,
  calendar_id             TEXT        NOT NULL DEFAULT 'primary',
  sync_enabled            BOOLEAN     NOT NULL DEFAULT TRUE,
  last_error              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_integrations_user_provider
  ON calendar_integrations(user_id, provider);
