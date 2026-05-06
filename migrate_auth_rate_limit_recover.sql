-- ============================================================
-- MIGRACAO: rate limit para recuperacao de senha
-- ============================================================
-- Permite registrar tentativas da rota /api/auth/recover na
-- tabela auth_rate_limit.
-- ============================================================

ALTER TABLE auth_rate_limit
DROP CONSTRAINT IF EXISTS auth_rate_limit_route_check;

ALTER TABLE auth_rate_limit
ADD CONSTRAINT auth_rate_limit_route_check
CHECK (route IN ('login', 'register', 'recover'));
