-- ============================================================
-- SCHEMA COMPLETO — Lembreto
-- Execute no SQL Editor do Neon antes do primeiro deploy.
-- Todos os comandos são idempotentes (IF NOT EXISTS).
-- ============================================================

-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  email       TEXT        UNIQUE NOT NULL,
  password    TEXT        NOT NULL,
  google_id   TEXT        UNIQUE,
  avatar      TEXT,
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  state_code  TEXT,
  city_name   TEXT,
  holiday_region_code TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabela de tarefas
CREATE TABLE IF NOT EXISTS tasks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  due_date    TIMESTAMPTZ,
  priority    TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  category    TEXT        NOT NULL DEFAULT 'Geral',
  suppress_holiday_notifications BOOLEAN NOT NULL DEFAULT FALSE,
  status      TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  history     JSONB       NOT NULL DEFAULT '[]'::JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
  ON users(google_id)
  WHERE google_id IS NOT NULL;
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE INDEX IF NOT EXISTS idx_tasks_tags_gin ON tasks USING GIN(tags);

CREATE TABLE IF NOT EXISTS user_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_categories_unique_name
  ON user_categories(user_id, lower(name));

CREATE TABLE IF NOT EXISTS user_tags (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tags_unique_name
  ON user_tags(user_id, lower(name));

-- Tabela de notas
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
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_user_created
  ON notes(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_user_mode
  ON notes(user_id, mode, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_task_id
  ON notes(task_id);

CREATE INDEX IF NOT EXISTS idx_notes_tags_gin
  ON notes USING GIN(tags);

-- ============================================================
-- Blacklist de tokens JWT (logout antecipado)
-- ============================================================
CREATE TABLE IF NOT EXISTS token_blacklist (
  token_jti   TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_blacklist_user_expires
  ON token_blacklist(user_id, expires_at);

-- ============================================================
-- Rate limiting de autenticação (login / register)
-- ESTAVA AUSENTE — causava erro em _rate_limit.ts
-- ============================================================
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  id           BIGSERIAL   PRIMARY KEY,
  ip           TEXT        NOT NULL,
  route        TEXT        NOT NULL CHECK (route IN ('login', 'register')),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arl_ip_route_time
  ON auth_rate_limit(ip, route, attempted_at);

-- ============================================================
-- Tokens de recuperação de senha
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_user_id    ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens(expires_at);

-- ============================================================
-- Central de notificacoes
-- ============================================================
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

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, read, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
  ON notifications(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        TEXT        NOT NULL UNIQUE,
  p256dh          TEXT        NOT NULL,
  auth            TEXT        NOT NULL,
  expiration_time BIGINT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_seen
  ON push_subscriptions(user_id, last_seen_at DESC);

-- ============================================================
-- Limpeza periódica (rode manualmente ou via cron na Vercel)
-- DELETE FROM token_blacklist      WHERE expires_at < NOW();
-- DELETE FROM auth_rate_limit      WHERE attempted_at < NOW() - INTERVAL '1 hour';
-- DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used = TRUE;
-- DELETE FROM notifications        WHERE created_at < NOW() - INTERVAL '180 days';
-- ============================================================
