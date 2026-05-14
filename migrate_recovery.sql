-- ============================================================
-- MIGRAÇÃO: Tabela de tokens para recuperação de senha
-- Execute no SQL Editor do Supabase/Postgres ANTES de fazer deploy.
-- ============================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,   -- SHA-256 do token bruto enviado por e-mail
  expires_at TIMESTAMPTZ NOT NULL,          -- expira em 1 hora
  used       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_user_id    ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens(expires_at);

-- Limpeza manual (rode periodicamente ou via cron na Vercel):
-- DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used = TRUE;

-- ============================================================
-- VARIÁVEIS DE AMBIENTE — adicione no .env.local e na Vercel:
--
--   RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
--     → Crie em https://resend.com → API Keys → Create API Key
--
--   APP_URL=https://lembreto.vercel.app
--     → URL pública do app (sem barra no final)
-- ============================================================
