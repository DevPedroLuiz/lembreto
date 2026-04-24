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
  avatar      TEXT,
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
  status      TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);

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
-- Limpeza periódica (rode manualmente ou via cron na Vercel)
-- DELETE FROM token_blacklist      WHERE expires_at < NOW();
-- DELETE FROM auth_rate_limit      WHERE attempted_at < NOW() - INTERVAL '1 hour';
-- DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used = TRUE;
-- ============================================================
