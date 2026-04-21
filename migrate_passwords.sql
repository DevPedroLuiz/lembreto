-- ============================================================
-- MIGRAÇÃO: Senhas em texto puro → bcrypt hash
-- ============================================================
-- ATENÇÃO: Este script invalida todas as senhas existentes.
-- Usuários precisarão redefinir a senha após a migração.
-- Execute este script UMA VEZ no banco de produção.
-- ============================================================

-- 1. Garante que a coluna password suporte hashes bcrypt
--    Hashes bcrypt têm sempre 60 caracteres. TEXT já comporta,
--    mas este comentário documenta o requisito.
-- (Nenhuma alteração de tipo necessária se a coluna já for TEXT)

-- 2. Invalida todas as senhas em texto puro substituindo por um
--    marcador especial. Usuários serão forçados a redefinir senha
--    via fluxo de recuperação.
UPDATE users
SET password = '$bcrypt$SENHA_INVALIDADA_USE_RECUPERACAO'
WHERE password NOT LIKE '$2b$%'   -- não são hashes bcrypt
  AND password NOT LIKE '$2a$%';  -- não são hashes bcrypt (formato antigo)

-- 3. (Opcional) Verificação: confirma quantas senhas foram invalidadas
-- SELECT COUNT(*) AS senhas_invalidadas
-- FROM users
-- WHERE password = '$bcrypt$SENHA_INVALIDADA_USE_RECUPERACAO';

-- ============================================================
-- APÓS EXECUTAR:
-- 1. Implante o novo código com bcrypt
-- 2. Avise os usuários que precisam redefinir a senha
-- 3. Implemente o envio de e-mail em /api/auth/recover
-- ============================================================
