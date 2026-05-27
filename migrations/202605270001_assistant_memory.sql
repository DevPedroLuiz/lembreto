CREATE TABLE IF NOT EXISTS assistant_conversations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user_updated
  ON assistant_conversations (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user_archived
  ON assistant_conversations (user_id, archived_at);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation_created
  ON assistant_messages (conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_user_created
  ON assistant_messages (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assistant_action_events (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id uuid NULL REFERENCES assistant_messages(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'needs_confirmation', 'skipped')),
  entity_type text NULL,
  entity_id uuid NULL,
  entity_title text NULL,
  summary text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_action_events_conversation_created
  ON assistant_action_events (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_action_events_user_created
  ON assistant_action_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_action_events_user_entity
  ON assistant_action_events (user_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS assistant_context_refs (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NULL,
  entity_title text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_context_refs_conversation_key_created
  ON assistant_context_refs (conversation_id, ref_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_context_refs_user_key_created
  ON assistant_context_refs (user_id, ref_key, created_at DESC);
