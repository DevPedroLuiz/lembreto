# Fluxo de notificações

1. O usuário cria ou edita um lembrete em `/api/tasks`.
2. O handler grava a tarefa e enfileira o side effect `sync_notification_schedules`.
3. O side effect sincroniza `notification_schedules`, cancelando pendentes antigos e recriando pré-aviso, aviso no horário, alarme e avisos de atraso.
4. O cron `/api/cron/notifications` processa side effects, backfill e agendas vencidas.
5. Cada agenda processada cria um registro em `notifications` e tenta enviar push quando o usuário tem assinatura ativa.
6. A fila pode ser inspecionada em `/api/notifications/schedules`, com status `pending`, `processing`, `sent`, `failed` e `cancelled`.

## Confiabilidade

- A chave `dedupe_key` evita duplicidade quando edição rápida e cron rodam perto um do outro.
- O backfill recria agendas ausentes para lembretes pendentes.
- Agendas travadas em `processing` são recuperadas pelo cron antes de buscar novos itens vencidos.
- O campo `pre_notice_minutes` permite pré-aviso por lembrete; quando ausente, o padrão continua sendo 15 minutos.
