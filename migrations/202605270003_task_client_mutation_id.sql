ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_mutation_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_user_client_mutation_id
  ON tasks(user_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;
