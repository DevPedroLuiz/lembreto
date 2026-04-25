# Lembreto

Sistema de gerenciamento de tarefas com dashboard, autenticacao, recuperacao de senha e API serverless.

## Stack

- Frontend: React 19 + TypeScript + Vite
- Estilo: Tailwind CSS v4 + Motion
- API: Vercel Functions + servidor Express para desenvolvimento local
- Banco: Neon Postgres
- Autenticacao: JWT + cookie HttpOnly para restauracao de sessao

## Funcionalidades

- Dashboard com metricas do dia
- CRUD completo de tarefas
- Perfil com avatar
- Login, cadastro, logout e restauracao de sessao
- Recuperacao e redefinicao de senha
- Rate limit em login e cadastro
- Blacklist de token no logout

## Variaveis de ambiente

Crie `.env.local` na raiz:

```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
JWT_SECRET=uma_chave_longa_e_aleatoria_com_pelo_menos_32_caracteres
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
APP_URL=http://localhost:3001
```

Notas:

- `JWT_SECRET` e obrigatoria em desenvolvimento e producao.
- `RESEND_API_KEY` e necessaria para envio real do email de recuperacao.
- `APP_URL` deve apontar para a URL publica do app em producao.

## Setup local

1. Instale dependencias:

```bash
npm install
```

2. Rode o schema e as migrations SQL no banco:

- `schema.sql`
- `migrate_jwt.sql`
- `migrate_recovery.sql`
- `migrate_passwords.sql` quando fizer a migracao de senhas legadas

3. Inicie o servidor local:

```bash
npm run dev
```

Por padrao o servidor local atual sobe em `http://localhost:3001`.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run test:e2e
npm run cleanup:db
```

## Testes

A suite cobre os pontos mais sensiveis da base:

- helpers de autenticacao
- cookies e protecao de origem
- validacao de avatar
- schemas de auth e tarefas
- fluxos E2E de cadastro, tarefas, perfil, reset de senha e sessao expirada

Rode com:

```bash
npm run test
npm run test:e2e
```

## CI

O repositório agora inclui pipeline em [`.github/workflows/ci.yml`](.github/workflows/ci.yml) para rodar:

- `npm run lint`
- `npm run build`
- `npm run test`
- `npm run test:e2e`

Para o workflow funcionar no GitHub Actions, configure estes secrets no repositório:

- `DATABASE_URL`
- `JWT_SECRET`

## Deploy

 O deploy protegido fica em [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
Ele publica em producao apenas quando o workflow `CI` termina com sucesso na branch `main`, ou manualmente via `workflow_dispatch`.

Secrets necessarios para deploy na Vercel:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Se quiser uma camada extra de seguranca, configure o ambiente `production` no GitHub com aprovacao obrigatoria antes do deploy.

## Operacao

### Limpeza periodica do banco

As tabelas abaixo precisam de limpeza periodica:

- `token_blacklist`
- `auth_rate_limit`
- `password_reset_tokens`

Use:

```bash
npm run cleanup:db
```

Em producao, o ideal e agendar esse script com cron.

### Seguranca aplicada

- validacao de payload com schemas compartilhados
- limite de tamanho e formato para avatar
- checagem de origem em rotas de sessao baseadas em cookie
- invalidacao de token no logout
- rotacao de token ao trocar email ou senha
- eventos de sessao expirada no cliente

## Estrutura

```text
api/                 Funcoes serverless
lib/                 Helpers compartilhados de auth, schemas e seguranca
scripts/             Scripts operacionais
e2e/                 Testes end-to-end com Playwright
src/                 Frontend React
server.ts            Servidor local de desenvolvimento
```
