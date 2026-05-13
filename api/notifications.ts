import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from './_db.js';
import {
  handleAlarmDismiss,
  handleNotificationById,
  handleAlarmSnooze,
  handleNotificationMarkAllRead,
  handleNotificationPushSubscriptions,
  handleNotificationSettings,
  handleNotificationsCollection,
} from '../lib/handlers/notifications.js';
import { buildHandlerRequest, sendHandlerResult } from '../lib/handlers/core.js';

function resolveQueryValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = resolveQueryValue(req.query.action as string | string[] | undefined);
  const notificationId = resolveQueryValue(req.query.id as string | string[] | undefined);
  const request = buildHandlerRequest(req);

  const result = await (async () => {
    if (action === 'push-subscriptions') {
      return handleNotificationPushSubscriptions({ sql, request });
    }

    if (action === 'settings') {
      return handleNotificationSettings({ sql, request });
    }

    if (action === 'mark-all-read') {
      return handleNotificationMarkAllRead({ sql, request });
    }

    if (action === 'alarm-snooze') {
      return handleAlarmSnooze({ sql, request });
    }

    if (action === 'alarm-dismiss') {
      return handleAlarmDismiss({ sql, request });
    }

    if (notificationId) {
      return handleNotificationById({ sql, request });
    }

    return handleNotificationsCollection({ sql, request });
  })();

  return sendHandlerResult(res, result);
}
