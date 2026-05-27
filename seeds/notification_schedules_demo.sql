-- Dados locais para testar o fluxo de notificações.
-- Ajuste o e-mail abaixo para um usuário existente no banco local.

WITH target_user AS (
  SELECT id
  FROM users
  WHERE email = 'demo@lembreto.local'
  LIMIT 1
),
created_task AS (
  INSERT INTO tasks (
    user_id,
    title,
    description,
    due_date,
    end_date,
    priority,
    category,
    alarm_enabled,
    pre_notice_minutes,
    reminder_mode,
    status
  )
  SELECT
    id,
    'Teste de notificações',
    'Lembrete criado pelo seed local.',
    NOW() + INTERVAL '30 minutes',
    NOW() + INTERVAL '45 minutes',
    'high',
    'Geral',
    TRUE,
    10,
    'timed',
    'pending'
  FROM target_user
  RETURNING id, user_id
)
INSERT INTO task_side_effects (user_id, task_id, kind, dedupe_key)
SELECT
  user_id,
  id,
  'sync_notification_schedules',
  'seed:sync-notification-schedules:' || id::text
FROM created_task
ON CONFLICT (user_id, dedupe_key) DO NOTHING;
