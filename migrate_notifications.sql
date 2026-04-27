ALTER TABLE users
ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS notifications (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT        NOT NULL,
  message        TEXT        NOT NULL,
  tone           TEXT        NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'success', 'warning', 'error')),
  read           BOOLEAN     NOT NULL DEFAULT FALSE,
  target_type    TEXT        CHECK (target_type IN ('task', 'notifications', 'profile', 'settings')),
  target_task_id UUID        REFERENCES tasks(id) ON DELETE SET NULL,
  dedupe_key     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_dedupe_key_key;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, read, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
  ON notifications(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
