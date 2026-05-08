import type { SqlClient } from './handlers/core.js';
import { cleanupExpiredNotificationTasks } from './notification-schedules.js';

export async function cleanupDatabase(sql: SqlClient) {
  const [blacklist, rateLimit, resetTokens, notifications, notificationTasks] = await Promise.all([
    sql`DELETE FROM token_blacklist WHERE expires_at < NOW() RETURNING token_jti`,
    sql`DELETE FROM auth_rate_limit WHERE attempted_at < NOW() - INTERVAL '1 hour' RETURNING id`,
    sql`DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used = TRUE RETURNING id`,
    sql`
      DELETE FROM notifications
      WHERE created_at < NOW() - INTERVAL '180 days'
      RETURNING id
    `.catch(() => []),
    cleanupExpiredNotificationTasks(sql).catch(() => ({
      floatingTasks: 0,
      overdueTasks: 0,
      cancelledSchedules: 0,
    })),
  ]);

  return {
    tokenBlacklistRows: blacklist.length,
    authRateLimitRows: rateLimit.length,
    passwordResetRows: resetTokens.length,
    notificationRows: notifications.length,
    floatingAutoDeletedRows: notificationTasks.floatingTasks,
    overdueAutoDeletedRows: notificationTasks.overdueTasks,
    notificationScheduleCancelledRows: notificationTasks.cancelledSchedules,
  };
}
