ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_reminder_intensity TEXT NOT NULL DEFAULT 'normal'
  CHECK (overdue_reminder_intensity IN ('gentle', 'normal', 'insistent', 'silent'));
