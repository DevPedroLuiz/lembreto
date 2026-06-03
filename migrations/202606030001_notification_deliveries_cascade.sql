ALTER TABLE notification_deliveries
DROP CONSTRAINT IF EXISTS notification_deliveries_notification_id_fkey;

ALTER TABLE notification_deliveries
ADD CONSTRAINT notification_deliveries_notification_id_fkey
FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE;
