CREATE TABLE IF NOT EXISTS notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id     UUID        REFERENCES tasks(id) ON DELETE SET NULL,
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL DEFAULT '',
  priority    TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  category    TEXT        NOT NULL DEFAULT 'Geral',
  tags        TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  mode        TEXT        NOT NULL DEFAULT 'temporary' CHECK (mode IN ('temporary', 'fixed')),
  expires_at  TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,
  delete_after TIMESTAMPTZ,
  deletion_reason TEXT CHECK (deletion_reason IN ('manual', 'expired')),
  expired_notification_sent_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
