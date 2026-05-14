-- Persistent task side effect queue.
-- Keeps user-facing task mutations fast and lets cron perform heavy work.

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
