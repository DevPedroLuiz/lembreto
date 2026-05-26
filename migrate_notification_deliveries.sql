CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  push_subscription_id UUID REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  endpoint_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  user_agent TEXT,
  channel TEXT NOT NULL DEFAULT 'push' CHECK (channel = 'push'),
  status TEXT NOT NULL DEFAULT 'attempted'
    CHECK (status IN ('attempted', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_deliveries_unique_device
  ON notification_deliveries(notification_id, endpoint_hash);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification
  ON notification_deliveries(notification_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user_created
  ON notification_deliveries(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status
  ON notification_deliveries(status, attempted_at DESC);
