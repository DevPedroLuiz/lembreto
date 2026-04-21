-- ============================================================
-- MIGRAÇÃO: Tabela de blacklist de tokens JWT
-- Execute no SQL Editor do Neon ANTES de fazer deploy.
-- ============================================================

-- Tabela para invalidar tokens via logout antes de expirarem
CREATE TABLE IF NOT EXISTS token_blacklist (
  token_jti   TEXT PRIMARY KEY,          -- "<user_id>_<iat>" — identificador único do token
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,      -- quando o token original expiraria
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para a query do middleware (filtra por user_id + expiração)
CREATE INDEX IF NOT EXISTS idx_token_blacklist_user_expires
  ON token_blacklist(user_id, expires_at);

-- Job de limpeza automática: remove tokens já expirados para a tabela não crescer
-- Execute manualmente quando necessário, ou configure um cron job na Vercel:
-- DELETE FROM token_blacklist WHERE expires_at < NOW();

-- ============================================================
-- VARIÁVEL DE AMBIENTE NECESSÁRIA
-- Adicione ao .env.local e ao painel Vercel → Settings → Env Vars:
--
--   JWT_SECRET=<string aleatória longa — mínimo 32 caracteres>
--
-- Para gerar uma boa chave:
--   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
-- ============================================================
