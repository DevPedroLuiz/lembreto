-- Keep user-facing task mutations fast by allowing deferred calendar sync
-- and by adding indexes used by lightweight schedule cancellation/lookup.

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS external_calendar_sync_status TEXT NOT NULL DEFAULT 'idle';

ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_external_calendar_sync_status_check;

ALTER TABLE tasks
ADD CONSTRAINT tasks_external_calendar_sync_status_check
CHECK (external_calendar_sync_status IN ('idle', 'pending', 'synced', 'failed'));

CREATE INDEX IF NOT EXISTS idx_notification_schedules_task_status
  ON notification_schedules(task_id, status);

CREATE INDEX IF NOT EXISTS idx_notification_schedules_due
  ON notification_schedules(status, notify_at);

CREATE INDEX IF NOT EXISTS idx_tasks_user_deleted_status
  ON tasks(user_id, deleted_at, status);
