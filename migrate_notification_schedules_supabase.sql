-- Notification schedules and logical cleanup for Supabase/Postgres.

ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE tasks
ADD CONSTRAINT tasks_status_check
CHECK (status IN ('pending', 'overdue', 'completed', 'draft', 'inactive', 'cancelled'));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS alarm_enabled BOOLEAN NOT NULL DEFAULT FALSE;
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
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS suppress_holiday_notifications BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS floating_interval_minutes INTEGER;

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

CREATE INDEX IF NOT EXISTS idx_notification_schedules_due
  ON notification_schedules(status, notify_at);

CREATE INDEX IF NOT EXISTS idx_notification_schedules_user_task
  ON notification_schedules(user_id, task_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_schedules_dedupe
  ON notification_schedules(user_id, dedupe_key);

ALTER TABLE notification_schedules
ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS source_schedule_id UUID;

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS kind TEXT CHECK (
  kind IN ('pre_notice', 'notification', 'alarm', 'floating_reminder', 'overdue_reminder')
);

ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_source_schedule_id_fkey;

ALTER TABLE notifications
ADD CONSTRAINT notifications_source_schedule_id_fkey
FOREIGN KEY (source_schedule_id) REFERENCES notification_schedules(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
ON notifications(user_id, dedupe_key)
WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_source_schedule
ON notifications(source_schedule_id)
WHERE source_schedule_id IS NOT NULL;
