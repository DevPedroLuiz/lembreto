import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { neon } from '@neondatabase/serverless';
import { logError, logInfo } from './lib/logger.js';
import {
  buildHandlerRequest,
  sendHandlerResult,
} from './lib/handlers/core.js';
import {
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe,
  handleAuthProfile,
  handleAuthRecover,
  handleAuthRegister,
  handleAuthResetPassword,
} from './lib/handlers/auth.js';
import {
  handleTaskById,
  handleTasksCollection,
} from './lib/handlers/tasks.js';
import { handleCleanupCron } from './lib/handlers/cron.js';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL nao definida.\n' +
    'Crie o arquivo .env.local na raiz do projeto com:\n' +
    'DATABASE_URL=postgresql://user:senha@host/dbname?sslmode=require'
  );
}

const sql = neon(process.env.DATABASE_URL);

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
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
}

function createHandlerRunner(defaultAppUrl?: string) {
  return (handler: (context: { sql: any; request: ReturnType<typeof buildHandlerRequest>; defaultAppUrl?: string }) => Promise<any>) =>
    async (req: express.Request, res: express.Response) => {
      const result = await handler({
        sql,
        request: buildHandlerRequest(req),
        defaultAppUrl,
      });

      return sendHandlerResult(res, result);
    };
}

async function startServer() {
  const app = express();
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  const defaultAppUrl = process.env.APP_URL ?? `http://localhost:${port}`;
  const run = createHandlerRunner(defaultAppUrl);

  app.set('trust proxy', true);
  app.use(express.json({ limit: '10mb' }));
  app.use(withRequestMeta);

  app.post('/api/auth/register', run(handleAuthRegister));
  app.post('/api/auth/login', run(handleAuthLogin));
  app.post('/api/auth/logout', run(handleAuthLogout));
  app.post('/api/auth/me', run(handleAuthMe));
  app.get('/api/auth/me', run(handleAuthMe));
  app.delete('/api/auth/me', run(handleAuthMe));
  app.post('/api/auth/recover', run(handleAuthRecover));
  app.post('/api/auth/reset-password', run(handleAuthResetPassword));
  app.put('/api/auth/profile', run(handleAuthProfile));

  app.get('/api/tasks', run(handleTasksCollection));
  app.post('/api/tasks', run(handleTasksCollection));
  app.put('/api/tasks/:id', run(handleTaskById));
  app.delete('/api/tasks/:id', run(handleTaskById));

  app.get('/api/cron/cleanup', run(handleCleanupCron));

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
