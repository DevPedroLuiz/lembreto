-- Lightweight indexes used by notification cron diagnostics and backfill.
-- Safe to run more than once; does not delete or rewrite production data.

CREATE INDEX IF NOT EXISTS idx_tasks_user_status_deleted
ON tasks(user_id, status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_tasks_status_due_date
ON tasks(status, due_date);

CREATE INDEX IF NOT EXISTS idx_notification_schedules_task_status
ON notification_schedules(task_id, status);

CREATE INDEX IF NOT EXISTS idx_task_side_effects_task
ON task_side_effects(task_id, status);
