# Notification scheduler

Este scheduler e um worker separado para chamar a rota:

```text
GET /api/cron/notifications
Authorization: Bearer CRON_SECRET
```

Ele nao acessa o banco. Toda a logica de fila, deduplicacao, envio push e backfill continua dentro da API do Lembreto.

## Por que ele existe

Na Vercel Hobby, cron nativo so pode rodar uma vez por dia. Para notificacoes em horario proximo do real, rode este scheduler em uma plataforma que mantenha processo Node ativo, como Railway, Render, Fly.io ou uma VPS.

## Variaveis

Obrigatorias:

```env
SCHEDULER_TARGET_URL=https://lembreto.vercel.app/api/cron/notifications
CRON_SECRET=o_mesmo_valor_configurado_na_vercel
```

Recomendadas:

```env
SCHEDULER_INTERVAL_MS=60000
SCHEDULER_BACKLOG_INTERVAL_MS=5000
SCHEDULER_REQUEST_TIMEOUT_MS=25000
SCHEDULER_RETRY_ATTEMPTS=3
PORT=8080
```

## Rodar localmente

```bash
SCHEDULER_TARGET_URL=http://localhost:3001/api/cron/notifications \
CRON_SECRET=seu_secret \
npm run scheduler:notifications
```

No PowerShell:

```powershell
$env:SCHEDULER_TARGET_URL='http://localhost:3001/api/cron/notifications'
$env:CRON_SECRET='seu_secret'
npm run scheduler:notifications
```

## Deploy como worker

### Railway ou Render

- Start command: `npm run scheduler:notifications`
- Health check path: `/health`
- Variaveis: `SCHEDULER_TARGET_URL`, `CRON_SECRET`, `SCHEDULER_INTERVAL_MS`

No Railway, o arquivo `railway.json` na raiz ja define o start command,
healthcheck e restart policy. Se o deploy aparecer como `Crashed`, confira
primeiro se as variaveis `SCHEDULER_TARGET_URL` e `CRON_SECRET` existem no
ambiente `production`.

### Docker

Use `scheduler/Dockerfile` com contexto na pasta `scheduler`.

```bash
docker build -t lembreto-scheduler ./scheduler
docker run --rm -p 8080:8080 \
  -e SCHEDULER_TARGET_URL=https://lembreto.vercel.app/api/cron/notifications \
  -e CRON_SECRET=seu_secret \
  lembreto-scheduler
```

## Garantias praticas

- Nao roda duas chamadas ao mesmo tempo no mesmo processo.
- Usa retry para falhas temporarias de rede, 408, 425, 429 e 5xx.
- Se a API responder que ainda ha backlog, roda de novo mais cedo.
- Expoe `/health` e `/ready` para a plataforma reiniciar o worker se ele ficar sem sucesso recente.
- Logs sao JSON para facilitar monitoramento.

Para maior confiabilidade, rode uma unica instancia com restart automatico habilitado na plataforma.
