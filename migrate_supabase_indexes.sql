-- ============================================================
-- MIGRACAO SEGURA: indices de performance para Supabase/Postgres
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_tasks_user_deleted_status
  ON tasks(user_id, deleted_at, status);

CREATE INDEX IF NOT EXISTS idx_tasks_user_due_date
  ON tasks(user_id, due_date);

CREATE INDEX IF NOT EXISTS idx_tasks_user_created
  ON tasks(user_id, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_notes_task_id
  ON notes(task_id);

CREATE INDEX IF NOT EXISTS idx_notes_user_created
  ON notes(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_schedules_due
  ON notification_schedules(status, notify_at);

CREATE INDEX IF NOT EXISTS idx_notification_schedules_task_status
  ON notification_schedules(task_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_schedules_dedupe
  ON notification_schedules(user_id, dedupe_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
  ON notifications(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_source_schedule
  ON notifications(source_schedule_id)
  WHERE source_schedule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

DROP INDEX IF EXISTS idx_calendar_integrations_user_provider;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_integrations_org_user_provider
  ON calendar_integrations(organization_id, user_id, provider)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_integrations_user_provider_legacy
  ON calendar_integrations(user_id, provider)
  WHERE organization_id IS NULL;
