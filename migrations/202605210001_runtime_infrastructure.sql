CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users ADD COLUMN IF NOT EXISTS state_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS holiday_region_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
  ON users(google_id)
  WHERE google_id IS NOT NULL;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS suppress_holiday_notifications BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS alarm_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_mode TEXT NOT NULL DEFAULT 'timed'
  CHECK (reminder_mode IN ('timed', 'floating'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_since TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_expires_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_source TEXT
  CHECK (completion_source IN ('user', 'system', 'calendar_sync'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS auto_deleted_reason TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS auto_deleted_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS floating_interval_minutes INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_reminder_intensity TEXT NOT NULL DEFAULT 'normal'
  CHECK (overdue_reminder_intensity IN ('gentle', 'normal', 'insistent', 'silent'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_calendar_provider TEXT
  CHECK (external_calendar_provider IN ('google', 'outlook'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_calendar_event_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_calendar_sync_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_calendar_last_error TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_calendar_synced_at TIMESTAMPTZ;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('pending', 'overdue', 'completed', 'draft', 'inactive', 'cancelled'));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_external_calendar_sync_status_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_external_calendar_sync_status_check
  CHECK (external_calendar_sync_status IN ('idle', 'pending', 'synced', 'failed'));

CREATE INDEX IF NOT EXISTS idx_tasks_tags_gin
  ON tasks USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_tasks_external_calendar
  ON tasks(user_id, external_calendar_provider, external_calendar_event_id)
  WHERE external_calendar_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_deleted_status
  ON tasks(user_id, deleted_at, status);

CREATE INDEX IF NOT EXISTS idx_tasks_user_deleted_status_created
  ON tasks(user_id, deleted_at, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_user_deleted_status_due
  ON tasks(user_id, deleted_at, status, due_date ASC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_user_priority_due
  ON tasks(user_id, priority, due_date ASC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_category_due
  ON tasks(user_id, category, due_date ASC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_search_gin
  ON tasks USING GIN (
    to_tsvector(
      'simple',
      coalesce(title, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(category, '')
    )
  )
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS user_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_categories_unique_name
  ON user_categories(user_id, lower(name));

CREATE TABLE IF NOT EXISTS user_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tags_unique_name
  ON user_tags(user_id, lower(name));

CREATE TABLE IF NOT EXISTS calendar_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_integrations_user_provider
  ON calendar_integrations(user_id, provider);

CREATE TABLE IF NOT EXISTS calendar_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_jti TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_feeds_user_active
  ON calendar_feeds(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  category TEXT NOT NULL DEFAULT 'Geral',
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  mode TEXT NOT NULL DEFAULT 'temporary' CHECK (mode IN ('temporary', 'fixed')),
  expires_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  delete_after TIMESTAMPTZ,
  deletion_reason TEXT,
  expired_notification_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS delete_after TIMESTAMPTZ;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deletion_reason TEXT;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS expired_notification_sent_at TIMESTAMPTZ;

UPDATE notes
SET expires_at = NOW() + INTERVAL '7 days'
WHERE mode = 'temporary'
  AND expires_at IS NULL
  AND deleted_at IS NULL;

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_deletion_reason_check;
ALTER TABLE notes
  ADD CONSTRAINT notes_deletion_reason_check
  CHECK (deletion_reason IN ('manual', 'expired'));

CREATE INDEX IF NOT EXISTS idx_notes_user_created
  ON notes(user_id, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_user_mode
  ON notes(user_id, deleted_at, mode, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_task_id
  ON notes(task_id);

CREATE INDEX IF NOT EXISTS idx_notes_tags_gin
  ON notes USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_notes_expiration
  ON notes(user_id, expires_at)
  WHERE deleted_at IS NULL AND mode = 'temporary';

CREATE INDEX IF NOT EXISTS idx_notes_trash_cleanup
  ON notes(user_id, delete_after)
  WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'success', 'warning', 'error')),
  read BOOLEAN NOT NULL DEFAULT FALSE,
  target_type TEXT CHECK (target_type IN ('task', 'notifications', 'profile', 'settings')),
  target_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  dedupe_key TEXT,
  source_schedule_id UUID,
  kind TEXT CHECK (kind IN ('pre_notice', 'notification', 'alarm', 'floating_reminder', 'overdue_reminder')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_dedupe_key_key;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source_schedule_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS kind TEXT
  CHECK (kind IN ('pre_notice', 'notification', 'alarm', 'floating_reminder', 'overdue_reminder'));

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, read, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
  ON notifications(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_source_schedule
  ON notifications(source_schedule_id)
  WHERE source_schedule_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time BIGINT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_seen
  ON push_subscriptions(user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS notification_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (
    kind IN ('pre_notice', 'notification', 'alarm', 'floating_reminder', 'overdue_reminder')
  ),
  notify_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'info'
    CHECK (tone IN ('info', 'success', 'warning', 'error')),
  dedupe_key TEXT NOT NULL,
  sequence_index INTEGER,
  interval_minutes INTEGER,
  processing_started_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notification_schedules ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notification_schedules_due
  ON notification_schedules(status, notify_at);

CREATE INDEX IF NOT EXISTS idx_notification_schedules_task_status
  ON notification_schedules(task_id, status);

CREATE INDEX IF NOT EXISTS idx_notification_schedules_user_task
  ON notification_schedules(user_id, task_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_schedules_dedupe
  ON notification_schedules(user_id, dedupe_key);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_source_schedule_id_fkey;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_source_schedule_id_fkey
  FOREIGN KEY (source_schedule_id) REFERENCES notification_schedules(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS task_side_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'sync_notification_schedules',
      'cancel_notification_schedules',
      'sync_external_calendar',
      'delete_external_calendar_event'
    )
  ),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'cancelled')),
  dedupe_key TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_side_effects_dedupe
  ON task_side_effects(user_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_task_side_effects_due
  ON task_side_effects(status, available_at);

CREATE INDEX IF NOT EXISTS idx_task_side_effects_task
  ON task_side_effects(task_id, status);
