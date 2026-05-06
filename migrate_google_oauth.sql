-- ============================================================
-- MIGRACAO: Login com Google
-- ============================================================
-- Execute uma vez no banco de producao para permitir vincular
-- contas do Google a usuarios do Lembreto.
-- ============================================================

ALTER TABLE users
ADD COLUMN IF NOT EXISTS google_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id
  ON users(google_id)
  WHERE google_id IS NOT NULL;
