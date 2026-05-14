# Lembreto

Sistema de gerenciamento de tarefas com dashboard, autenticação, recuperação de senha e API serverless.

## Stack

- Frontend: React 19 + TypeScript + Vite
- Estilo: Tailwind CSS v4 + Motion
- API: Vercel Functions + servidor Express para desenvolvimento local
- Banco: Neon Postgres
- Autenticação: JWT + cookie HttpOnly para restauração de sessão

## Funcionalidades

- Dashboard com metricas do dia
- CRUD completo de tarefas
- Perfil com avatar
- Login, cadastro, logout e restauração de sessão
- Recuperação e redefinição de senha
- Rate limit em login e cadastro
- Blacklist de token no logout

## Variaveis de ambiente

Crie `.env.local` na raiz:

```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
JWT_SECRET=uma_chave_longa_e_aleatoria_com_pelo_menos_32_caracteres
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
APP_URL=http://localhost:3001
GOOGLE_CLIENT_ID=seu_client_id_do_google.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=seu_client_secret_do_google
GOOGLE_CALENDAR_CLIENT_ID=seu_client_id_do_google_calendar.apps.googleusercontent.com
GOOGLE_CALENDAR_CLIENT_SECRET=seu_client_secret_do_google_calendar
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3001/api/calendar/google/callback
OUTLOOK_CLIENT_ID=seu_client_id_do_microsoft_entra
OUTLOOK_CLIENT_SECRET=seu_client_secret_do_microsoft_entra
OUTLOOK_REDIRECT_URI=http://localhost:3001/api/calendar/outlook/callback
CALENDAR_TOKEN_ENCRYPTION_KEY=chave_opcional_para_criptografar_tokens_de_calendario
VITE_RECAPTCHA_SITE_KEY=sua_chave_do_site_recaptcha_v2
RECAPTCHA_SITE_KEY=sua_chave_do_site_recaptcha_v2
RECAPTCHA_SECRET_KEY=sua_chave_secreta_recaptcha_v2
CRON_SECRET=uma_segunda_chave_longa_para_rotas_agendadas
```

Notas:

- `JWT_SECRET` é obrigatória em desenvolvimento e produção.
- `RESEND_API_KEY` é necessária para envio real do e-mail de recuperação.
- `APP_URL` deve apontar para a URL pública do app em produção.
- `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` habilitam o botão "Entrar com Google".
- No Google Cloud Console, configure o redirect URI autorizado como `{APP_URL}/api/auth/google/callback`.
- `GOOGLE_CALENDAR_CLIENT_ID` e `GOOGLE_CALENDAR_CLIENT_SECRET` habilitam a integração com Google Calendar usando o escopo `https://www.googleapis.com/auth/calendar.events`.
- `OUTLOOK_CLIENT_ID` e `OUTLOOK_CLIENT_SECRET` habilitam a integração com Outlook Calendar usando o escopo Microsoft Graph `Calendars.ReadWrite`.
- Configure os redirect URIs de calendário como `{APP_URL}/api/calendar/google/callback` e `{APP_URL}/api/calendar/outlook/callback`.
- `CALENDAR_TOKEN_ENCRYPTION_KEY` é opcional, mas recomendada em produção; se ausente, o app deriva a chave de criptografia a partir de `JWT_SECRET`.
- `VITE_RECAPTCHA_SITE_KEY` e `RECAPTCHA_SECRET_KEY` habilitam o reCAPTCHA v2 checkbox no login, cadastro e recuperação de senha. Em produção, `RECAPTCHA_SITE_KEY` pode ser usada como fallback runtime pela rota `/api/auth/config`.
- `CRON_SECRET` protege as rotas internas chamadas por agendadores externos.

## Setup local

1. Instale dependências:

```bash
npm install
```

2. Rode o schema e as migrations SQL no banco:

- `schema.sql`
- `migrate_jwt.sql`
- `migrate_recovery.sql`
- `migrate_google_oauth.sql`
- `migrate_auth_rate_limit_recover.sql`
- `migrate_calendar_integrations.sql`
- `migrate_passwords.sql` quando fizer a migração de senhas legadas

3. Inicie o servidor local:

```bash
npm run dev
```

Por padrão, o servidor local atual sobe em `http://localhost:3001`.

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

A suíte cobre os pontos mais sensíveis da base:

- helpers de autenticação
- cookies e proteção de origem
- validação de avatar
- schemas de auth e tarefas
- fluxos E2E de cadastro, tarefas, perfil, reset de senha e sessão expirada

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
Ele publica em produção apenas quando o workflow `CI` termina com sucesso na branch `main`, ou manualmente via `workflow_dispatch`.

Secrets necessários para deploy na Vercel:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Se quiser uma camada extra de segurança, configure o ambiente `production` no GitHub com aprovação obrigatória antes do deploy.

## Scheduler externo para lembretes

O projeto inclui um scheduler externo em [`.github/workflows/reminder-scheduler.yml`](.github/workflows/reminder-scheduler.yml).
Ele chama `GET /api/cron/notifications` pelo GitHub Actions a cada 1 minuto para:

- enviar o pre-aviso de 15 minutos;
- avisar no horario definido no lembrete;
- disparar alarmes e sonecas no horario correto;
- processar lembretes sem horario (`floating_reminder`);
- repetir alertas de lembretes atrasados em intervalos regulares;
- persistir esses avisos na central de notificacoes.

Esse fluxo funciona bem no plano Hobby da Vercel porque o agendamento frequente fica fora do cron nativo da Vercel. O `vercel.json` deve manter apenas `/api/cron/cleanup` como cron diario; um cron diario em `/api/cron/notifications` quebra a logica de notificacoes no horario correto.

### Frequencia recomendada

Para producao, chame:

```text
GET https://SEU-DOMINIO.com/api/cron/notifications
Authorization: Bearer {CRON_SECRET}
```

Use a frequencia de 1 minuto para reduzir atraso perceptivel em pre-avisos, notificacoes e alarmes.

Servicos que podem chamar esse endpoint:

- cron-job.org
- EasyCron
- UptimeRobot
- GitHub Actions scheduled workflow
- Supabase pg_cron, se disponivel

### Secrets necessários

No GitHub Actions, configure:

- `APP_URL`
- `CRON_SECRET`

Na Vercel, configure o mesmo `CRON_SECRET` nas variaveis de ambiente do projeto. O valor de `CRON_SECRET` nos GitHub Actions Secrets precisa ser igual ao valor configurado na Vercel.

Exemplo:

- `APP_URL=https://seu-projeto.vercel.app`
- `CRON_SECRET=<valor-aleatorio-longo>`

### Como funciona

O workflow roda a cada 1 minuto.
Cada execucao faz uma chamada autenticada para:

```text
GET {APP_URL}/api/cron/notifications
Authorization: Bearer {CRON_SECRET}
```

Se quiser testar manualmente, abra a aba `Actions` no GitHub e rode `Reminder Scheduler` com `workflow_dispatch`.

O `vercel.json` deve manter apenas `/api/cron/cleanup` no Vercel Cron diario, com schedule como `0 3 * * *`. Nao recoloque `/api/cron/notifications` no Vercel Cron; esse endpoint e acionado pelo GitHub Actions.

## Operação

### Limpeza periodica do banco

As tabelas abaixo precisam de limpeza periodica:

- `token_blacklist`
- `auth_rate_limit`
- `password_reset_tokens`

Use:

```bash
npm run cleanup:db
```

Em produção, o ideal é agendar esse script com cron. No plano Hobby da Vercel, o cron precisa rodar no máximo uma vez por dia.

### Seguranca aplicada

- validação de payload com schemas compartilhados
- limite de tamanho e formato para avatar
- checagem de origem em rotas de sessão baseadas em cookie
- invalidação de token no logout
- rotação de token ao trocar e-mail ou senha
- eventos de sessão expirada no cliente

## Estrutura

```text
api/                 Funções serverless
lib/                 Helpers compartilhados de auth, schemas e segurança
scripts/             Scripts operacionais
e2e/                 Testes end-to-end com Playwright
src/                 Frontend React
server.ts            Servidor local de desenvolvimento
```
