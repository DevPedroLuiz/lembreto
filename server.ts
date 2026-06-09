import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createSqlClient, resolveDatabaseUrl } from './lib/db.js';
import { logError, logInfo } from './lib/logger.js';
import {
  type HandlerContext,
  type HandlerResult,
  buildHandlerRequest,
  handleCorsPreflight,
  sendHandlerResult,
} from './lib/handlers/core.js';
import {
  handleAuthConfig,
  handleAuthCancelAccount,
  handleAuthGoogleCallback,
  handleAuthGoogleStart,
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe,
  handleAuthProfile,
  handleAuthRecover,
  handleAuthRegister,
  handleAuthResendVerification,
  handleAuthResetPassword,
  handleAuthSessions,
  handleAuthVerifyEmail,
} from './lib/handlers/auth.js';
import {
  handleTaskById,
  handleTaskCalendarExport,
  handleTaskCalendarFeed,
  handleTaskCategoriesCollection,
  handleTaskHolidayLocationDetect,
  handleTaskHolidays,
  handleTaskTagsCollection,
  handleTaskTaxonomy,
  handleTasksCollection,
} from './lib/handlers/tasks.js';
import {
  handleNoteById,
  handleNotesCollection,
} from './lib/handlers/notes.js';
import { handleAssistantMessage, handleAssistantScreenshot } from './lib/handlers/assistant.js';
import { handleCleanupCron } from './lib/handlers/cron.js';
import {
  handleBilling,
  handleMercadoPagoWebhookRaw,
} from './lib/handlers/billing.js';
import { handleOrganization } from './lib/handlers/organization.js';
import {
  handleCalendarConnectCallback,
  handleCalendarConnectStart,
  handleCalendarDisconnect,
  handleCalendarIntegrations,
  handleCalendarIntegrationSettings,
  handleCalendarSyncAll,
  handleCalendarTaskSync,
} from './lib/handlers/calendar.js';
import {
  handleAlarmDismiss,
  handleNotificationById,
  handleAlarmSnooze,
  handleNotificationsCollection,
  handleNotificationsCron,
  handleNotificationPushSubscriptions,
  handleNotificationSettings,
  handleNotificationMarkAllRead,
  handleNotificationProcessDue,
  handleNotificationSchedulesQueue,
} from './lib/handlers/notifications.js';

if (!resolveDatabaseUrl()) {
  throw new Error(
    'URL do banco nao definida.\n' +
    'Crie o arquivo .env.local na raiz do projeto com:\n' +
    'DATABASE_URL=postgresql://user:senha@host/dbname?sslmode=require'
  );
}

const sql = createSqlClient();

function withRequestMeta(req: express.Request, res: express.Response, next: express.NextFunction) {
  const requestId =
    (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();

  (req as express.Request & { requestId?: string }).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    logInfo('http_request', {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
}

function createHandlerRunner(defaultAppUrl?: string) {
  return (handler: (context: HandlerContext) => Promise<HandlerResult>) =>
    async (req: express.Request, res: express.Response) => {
      const request = buildHandlerRequest(req);
      const preflight = handleCorsPreflight(request);
      if (preflight) return sendHandlerResult(res, preflight, request);

      const result = await handler({
        sql,
        request,
        defaultAppUrl,
      });

      return sendHandlerResult(res, result, request);
    };
}

async function startServer() {
  const app = express();
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  const defaultAppUrl = process.env.APP_URL ?? `http://localhost:${port}`;
  const run = createHandlerRunner(defaultAppUrl);

  app.set('trust proxy', true);
  app.use(withRequestMeta);
  app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signatureHeader = req.headers['x-signature'];
    const requestIdHeader = req.headers['x-request-id'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
    const result = await handleMercadoPagoWebhookRaw(
      sql,
      Buffer.isBuffer(req.body) ? req.body : Buffer.from(''),
      { signature, requestId },
      req.query,
    );
    return sendHandlerResult(res, result);
  });
  app.use(express.json({ limit: '10mb' }));
  app.options('/api/*', (req, res) => {
    const request = buildHandlerRequest(req);
    return sendHandlerResult(res, handleCorsPreflight(request) ?? { status: 204 }, request);
  });

  app.post('/api/auth/register', run(handleAuthRegister));
  app.post('/api/auth/login', run(handleAuthLogin));
  app.get('/api/auth/config', run(handleAuthConfig));
  app.get('/api/auth/google/start', run(handleAuthGoogleStart));
  app.get('/api/auth/google/callback', run(handleAuthGoogleCallback));
  app.post('/api/auth/logout', run(handleAuthLogout));
  app.post('/api/auth/me', run(handleAuthMe));
  app.get('/api/auth/me', run(handleAuthMe));
  app.delete('/api/auth/me', run(handleAuthMe));
  app.post('/api/auth/recover', run(handleAuthRecover));
  app.post('/api/auth/reset-password', run(handleAuthResetPassword));
  app.get('/api/auth/verify-email', run(handleAuthVerifyEmail));
  app.post('/api/auth/verify-email', run(handleAuthVerifyEmail));
  app.post('/api/auth/verify-email/resend', run(handleAuthResendVerification));
  app.get('/api/auth/sessions', run(handleAuthSessions));
  app.delete('/api/auth/sessions', run(handleAuthSessions));
  app.delete('/api/auth/account', run(handleAuthCancelAccount));
  app.put('/api/auth/profile', run(handleAuthProfile));

  app.post('/api/billing', run(handleBilling));

  app.get('/api/organization', run(handleOrganization));
  app.post('/api/organization', run(handleOrganization));
  app.put('/api/organization', run(handleOrganization));
  app.delete('/api/organization', run(handleOrganization));

  app.get('/api/tasks', run(handleTasksCollection));
  app.post('/api/tasks', run(handleTasksCollection));
  app.get('/api/tasks/metadata', run(handleTaskTaxonomy));
  app.get('/api/tasks/calendar.ics', run(handleTaskCalendarExport));
  app.all('/api/tasks/calendar/feed', run(handleTaskCalendarFeed));
  app.get('/api/tasks/holidays', run(handleTaskHolidays));
  app.post('/api/tasks/holidays/location', run(handleTaskHolidayLocationDetect));
  app.post('/api/tasks/categories', run(handleTaskCategoriesCollection));
  app.delete('/api/tasks/categories', run(handleTaskCategoriesCollection));
  app.post('/api/tasks/tags', run(handleTaskTagsCollection));
  app.delete('/api/tasks/tags', run(handleTaskTagsCollection));
  app.put('/api/tasks/:id', run(handleTaskById));
  app.delete('/api/tasks/:id', run(handleTaskById));

  app.post('/api/assistant/message', run(handleAssistantMessage));
  app.post('/api/assistant/screenshot', run(handleAssistantScreenshot));

  app.all('/api/tasks/notes', async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido' });
      return;
    }

    await run(handleNotesCollection)(req, res);
  });

  app.all('/api/tasks/notes/:id', async (req, res) => {
    if (req.method !== 'PUT' && req.method !== 'DELETE') {
      res.status(405).json({ error: 'Método não permitido' });
      return;
    }

    await run(handleNoteById)(req, res);
  });

  app.get('/api/notifications', run(handleNotificationsCollection));
  app.post('/api/notifications', run(handleNotificationsCollection));
  app.delete('/api/notifications', run(handleNotificationsCollection));
  app.post('/api/notifications/mark-all-read', run(handleNotificationMarkAllRead));
  app.post('/api/notifications/process-due', run(handleNotificationProcessDue));
  app.get('/api/notifications/schedules', run(handleNotificationSchedulesQueue));
  app.get('/api/notifications/settings', run(handleNotificationSettings));
  app.put('/api/notifications/settings', run(handleNotificationSettings));
  app.post('/api/notifications/push-subscriptions', run(handleNotificationPushSubscriptions));
  app.delete('/api/notifications/push-subscriptions', run(handleNotificationPushSubscriptions));
  app.post('/api/notifications/alarms/:id/snooze', run(handleAlarmSnooze));
  app.post('/api/notifications/alarms/:id/dismiss', run(handleAlarmDismiss));
  app.put('/api/notifications/:id', run(handleNotificationById));

  app.get('/api/calendar/integrations', run(handleCalendarIntegrations));
  app.get('/api/calendar/:provider/connect', run(handleCalendarConnectStart));
  app.get('/api/calendar/:provider/callback', run(handleCalendarConnectCallback));
  app.delete('/api/calendar/:provider', run(handleCalendarDisconnect));
  app.put('/api/calendar/:provider', run(handleCalendarIntegrationSettings));
  app.post('/api/calendar/:provider/sync-all', run(handleCalendarSyncAll));
  app.post('/api/calendar/tasks/:taskId/sync', run(handleCalendarTaskSync));

  app.get('/api/cron/cleanup', run(handleCleanupCron));
  app.get('/api/cron/notifications', run(handleNotificationsCron));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(port, '0.0.0.0', () => {
    logInfo('server_started', { port });
  });
}

startServer().catch((error) => {
  logError('server_boot_failed', error);
});
