-- Indexes used by GET /api/tasks pagination, filters, sorting, and search.

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
