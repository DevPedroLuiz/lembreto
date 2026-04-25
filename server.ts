import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { neon } from '@neondatabase/serverless';
import { signToken, verifyToken, extractBearerToken } from './lib/jwt.js';
import {
  buildTokenJti,
  getAuthFailureResponse,
  requireAuthFromAuthorizationHeader,
  requireAuthFromToken,
} from './lib/auth.js';
import {
  buildSessionCookie,
  clearSessionCookie,
  getSessionTokenFromCookieHeader,
} from './lib/session.js';
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  sendRecoveryEmail,
} from './lib/password-reset.js';
import { isTrustedRequestOrigin } from './lib/csrf.js';
import { logError, logInfo, logWarn } from './lib/logger.js';
import {
  createTaskSchema,
  formatZodError,
  loginSchema,
  profileUpdateSchema,
  recoverPasswordSchema,
  registerSchema,
  resetPasswordSchema,
  updateTaskSchema,
} from './lib/schemas.js';
import { checkRateLimit, clearRateLimit } from './api/_rate_limit.js';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL nao definida.\n' +
    'Crie o arquivo .env.local na raiz do projeto com:\n' +
    'DATABASE_URL=postgresql://user:senha@host/dbname?sslmode=require'
  );
}

const sql = neon(process.env.DATABASE_URL);
logInfo('database_loaded');

function getIP(req: express.Request): string {
  return (
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ??
    req.ip ??
    req.socket.remoteAddress ??
    'unknown'
  );
}

const authMiddleware = async (req: any, res: any, next: any) => {
  try {
    const auth = await requireAuthFromAuthorizationHeader(sql, req.headers.authorization);
    req.user = auth.user;
    req.authPayload = auth.payload;
    next();
  } catch (error: any) {
    const authFailure = getAuthFailureResponse(error);
    if (authFailure) return res.status(authFailure.status).json({ error: authFailure.error });

    logError('auth_middleware_failed', error, { requestId: req.requestId });
    return res.status(500).json({ error: 'Erro interno ao autenticar' });
  }
};

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.set('trust proxy', true);
  app.use(express.json({ limit: '10mb' }));
  app.use((req: any, res, next) => {
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
    req.requestId = requestId;
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
  });

  app.post('/api/auth/register', async (req: any, res) => {
    const ip = getIP(req);
    const parsed = registerSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: formatZodError(parsed.error) });

    const rl = await checkRateLimit(ip, 'register');
    if (!rl.allowed) {
      const minutes = Math.ceil((rl.retryAfterSeconds ?? 60) / 60);
      logWarn('auth_register_rate_limited', { ip, requestId: req.requestId });
      return res.status(429).json({
        error: `Muitas tentativas. Tente novamente em ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
        retryAfterSeconds: rl.retryAfterSeconds,
      });
    }

    const { name, email, password } = parsed.data;

    try {
      const existing = await sql`
        SELECT id FROM users WHERE email = ${email}
      `;
      if (existing.length > 0)
        return res.status(400).json({ error: 'Este email já está em uso' });

      const passwordHash = await bcrypt.hash(password, 12);
      const rows = await sql`
        INSERT INTO users (name, email, password)
        VALUES (${name}, ${email}, ${passwordHash})
        RETURNING id, name, email, avatar
      `;

      await clearRateLimit(ip, 'register');

      const user = rows[0];
      const token = signToken({ sub: user.id, email: user.email });
      logInfo('auth_register_success', { userId: user.id, requestId: req.requestId });
      return res.status(201).json({ user, token });
    } catch (error) {
      logError('auth_register_failed', error, { email, requestId: req.requestId });
      return res.status(500).json({ error: 'Erro ao criar usuario' });
    }
  });

  app.post('/api/auth/login', async (req: any, res) => {
    const ip = getIP(req);
    const parsed = loginSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: formatZodError(parsed.error) });

    const rl = await checkRateLimit(ip, 'login');
    if (!rl.allowed) {
      const minutes = Math.ceil((rl.retryAfterSeconds ?? 60) / 60);
      logWarn('auth_login_rate_limited', { ip, requestId: req.requestId });
      return res.status(429).json({
        error: `Muitas tentativas. Tente novamente em ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
        retryAfterSeconds: rl.retryAfterSeconds,
      });
    }

    const { email, password } = parsed.data;

    try {
      const rows = await sql`
        SELECT id, name, email, avatar, password AS password_hash
        FROM users WHERE email = ${email}
      `;

      if (rows.length === 0)
        return res.status(401).json({ error: 'Email ou senha incorretos' });

      const user = rows[0];
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch)
        return res.status(401).json({ error: 'Email ou senha incorretos' });

      await clearRateLimit(ip, 'login');

      const { password_hash: _passwordHash, ...safeUser } = user;
      const token = signToken({ sub: safeUser.id, email: safeUser.email });
      logInfo('auth_login_success', { userId: safeUser.id, requestId: req.requestId });
      return res.json({ user: safeUser, token });
    } catch (error) {
      logError('auth_login_failed', error, { email, requestId: req.requestId });
      return res.status(500).json({ error: 'Erro interno' });
    }
  });

  app.post('/api/auth/logout', async (req: any, res) => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return res.json({ message: 'Logout realizado com sucesso' });

    try {
      const payload = verifyToken(token);
      await sql`
        INSERT INTO token_blacklist (token_jti, user_id, expires_at)
        VALUES (${buildTokenJti(payload)}, ${payload.sub}, to_timestamp(${payload.exp ?? 0}))
        ON CONFLICT (token_jti) DO NOTHING
      `;
      logInfo('auth_logout_success', { userId: payload.sub, requestId: req.requestId });
    } catch (error) {
      logWarn('auth_logout_with_invalid_token', { requestId: req.requestId });
    }

    return res.json({ message: 'Logout realizado com sucesso' });
  });

  app.post('/api/auth/me', async (req: any, res) => {
    if (!isTrustedRequestOrigin(req.headers)) {
      logWarn('auth_me_post_csrf_blocked', { requestId: req.requestId });
      return res.status(403).json({ error: 'Origem nao permitida' });
    }

    try {
      const { payload, token } = await requireAuthFromAuthorizationHeader(sql, req.headers.authorization);
      res.setHeader('Set-Cookie', buildSessionCookie(token, 7 * 24 * 60 * 60));
      return res.status(200).json({ ok: true, sub: payload.sub });
    } catch (error) {
      const authFailure = getAuthFailureResponse(error);
      if (authFailure) return res.status(authFailure.status).json({ error: authFailure.error });
      logError('auth_me_post_failed', error, { requestId: req.requestId });
      return res.status(500).json({ error: 'Erro interno' });
    }
  });

  app.get('/api/auth/me', async (req: any, res) => {
    const token = getSessionTokenFromCookieHeader(req.headers.cookie);
    if (!token) return res.status(401).json({ error: 'Sem sessao ativa' });

    try {
      const { user } = await requireAuthFromToken(sql, token);
      return res.status(200).json({ user, token });
    } catch (error) {
      const authFailure = getAuthFailureResponse(error);
      if (authFailure) {
        res.setHeader('Set-Cookie', clearSessionCookie());
        return res.status(authFailure.status).json({ error: authFailure.error });
      }
      logError('auth_me_get_failed', error, { requestId: req.requestId });
      return res.status(500).json({ error: 'Erro interno' });
    }
  });

  app.delete('/api/auth/me', async (req: any, res) => {
    if (!isTrustedRequestOrigin(req.headers)) {
      logWarn('auth_me_delete_csrf_blocked', { requestId: req.requestId });
      return res.status(403).json({ error: 'Origem nao permitida' });
    }

    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  });

  app.post('/api/auth/recover', async (req: any, res) => {
    const parsed = recoverPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: formatZodError(parsed.error) });

    const { email } = parsed.data;

    try {
      const rows = await sql`
        SELECT id, name FROM users WHERE email = ${email}
      `;

      if (rows.length > 0) {
        const user = rows[0];

        await sql`
          UPDATE password_reset_tokens
          SET used = TRUE
          WHERE user_id = ${user.id} AND used = FALSE AND expires_at > NOW()
        `;

        const { rawToken, tokenHash, expiresAt } = createPasswordResetToken();
        await sql`
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES (${user.id}, ${tokenHash}, ${expiresAt})
        `;

        const appUrl = process.env.APP_URL ?? `http://localhost:${PORT}`;
        const resetLink = `${appUrl}/reset-password?token=${rawToken}`;

        try {
          await sendRecoveryEmail(email, user.name, resetLink);
          logInfo('auth_recover_email_sent', { userId: user.id, requestId: req.requestId });
        } catch (error) {
          logError('auth_recover_email_failed', error, { userId: user.id, requestId: req.requestId });
        }
      }
    } catch (error) {
      logError('auth_recover_failed', error, { email, requestId: req.requestId });
    }

    return res.json({ message: 'Se este email estiver cadastrado, voce recebera um link em breve.' });
  });

  app.post('/api/auth/reset-password', async (req: any, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: formatZodError(parsed.error) });

    const { token, password } = parsed.data;

    try {
      const tokenHash = hashPasswordResetToken(token);
      const rows = await sql`
        SELECT id AS token_id, user_id
        FROM password_reset_tokens
        WHERE token_hash = ${tokenHash}
          AND used = FALSE
          AND expires_at > NOW()
      `;

      if (rows.length === 0) {
        return res.status(400).json({
          error: 'Link invalido ou expirado. Solicite um novo link de recuperacao.',
        });
      }

      const { token_id, user_id } = rows[0];
      const passwordHash = await bcrypt.hash(password, 12);

      await sql`UPDATE users SET password = ${passwordHash} WHERE id = ${user_id}`;
      await sql`UPDATE password_reset_tokens SET used = TRUE WHERE id = ${token_id}`;

      logInfo('auth_password_reset_success', { userId: user_id, requestId: req.requestId });
      return res.status(200).json({
        message: 'Senha redefinida com sucesso! Voce ja pode fazer login.',
      });
    } catch (error) {
      logError('auth_password_reset_failed', error, { requestId: req.requestId });
      return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
    }
  });

  app.put('/api/auth/profile', authMiddleware, async (req: any, res) => {
    const parsed = profileUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: formatZodError(parsed.error) });

    const { name, email, password, avatar } = parsed.data;
    const userId = req.user.id as string;

    try {
      if (email && email !== req.user.email) {
        const conflict = await sql`
          SELECT id FROM users WHERE email = ${email} AND id != ${userId}
        `;
        if (conflict.length > 0)
          return res.status(400).json({ error: 'Este email ja esta em uso' });
      }

      const current = await sql`
        SELECT name, email, password, avatar FROM users WHERE id = ${userId}
      `;
      if (current.length === 0) return res.status(404).json({ error: 'Usuario nao encontrado' });

      const cur = current[0];
      let newPasswordHash = cur.password;
      if (password && password.trim()) {
        newPasswordHash = await bcrypt.hash(password.trim(), 12);
      }

      const nextEmail = email || cur.email;
      const shouldRotateToken =
        Boolean(password && password.trim()) || nextEmail !== req.user.email;

      const rows = await sql`
        UPDATE users
        SET name     = ${name || cur.name},
            email    = ${nextEmail},
            password = ${newPasswordHash},
            avatar   = ${avatar !== undefined ? avatar : cur.avatar}
        WHERE id = ${userId}
        RETURNING id, name, email, avatar
      `;

      const user = rows[0];

      if (shouldRotateToken && req.authPayload) {
        await sql`
          INSERT INTO token_blacklist (token_jti, user_id, expires_at)
          VALUES (
            ${buildTokenJti(req.authPayload)},
            ${req.authPayload.sub},
            to_timestamp(${req.authPayload.exp ?? 0})
          )
          ON CONFLICT (token_jti) DO NOTHING
        `;

        const token = signToken({ sub: user.id, email: user.email });
        logInfo('auth_profile_updated_with_token_rotation', { userId, requestId: req.requestId });
        return res.json({ user, token });
      }

      logInfo('auth_profile_updated', { userId, requestId: req.requestId });
      return res.json({ user });
    } catch (error) {
      logError('auth_profile_update_failed', error, { userId, requestId: req.requestId });
      return res.status(500).json({ error: 'Erro ao atualizar perfil' });
    }
  });

  app.get('/api/tasks', authMiddleware, async (req: any, res) => {
    try {
      const rows = await sql`
        SELECT id, user_id AS "userId", title, description,
               due_date AS "dueDate", priority, category, status,
               created_at AS "createdAt"
        FROM tasks WHERE user_id = ${req.user.id}
        ORDER BY created_at DESC
      `;
      return res.json(rows);
    } catch (error) {
      logError('tasks_list_failed', error, { userId: req.user.id, requestId: req.requestId });
      return res.status(500).json({ error: 'Erro ao buscar tarefas' });
    }
  });

  app.post('/api/tasks', authMiddleware, async (req: any, res) => {
    const parsed = createTaskSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: formatZodError(parsed.error) });

    const { title, description, dueDate, priority, category } = parsed.data;

    try {
      const rows = await sql`
        INSERT INTO tasks (user_id, title, description, due_date, priority, category)
        VALUES (${req.user.id}, ${title}, ${description}, ${dueDate || null}, ${priority}, ${category})
        RETURNING id, user_id AS "userId", title, description,
                  due_date AS "dueDate", priority, category, status,
                  created_at AS "createdAt"
      `;
      logInfo('task_created', { userId: req.user.id, requestId: req.requestId });
      return res.status(201).json(rows[0]);
    } catch (error) {
      logError('task_create_failed', error, { userId: req.user.id, requestId: req.requestId });
      return res.status(500).json({ error: 'Erro ao criar tarefa' });
    }
  });

  app.put('/api/tasks/:id', authMiddleware, async (req: any, res) => {
    const parsed = updateTaskSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: formatZodError(parsed.error) });

    const { id } = req.params;
    const { title, description, dueDate, priority, category, status } = parsed.data;

    try {
      const current = await sql`
        SELECT title, description, due_date, priority, category, status
        FROM tasks WHERE id = ${id} AND user_id = ${req.user.id}
      `;
      if (current.length === 0) return res.status(404).json({ error: 'Tarefa nao encontrada' });

      const cur = current[0];
      const rows = await sql`
        UPDATE tasks SET
          title       = ${title !== undefined ? title : cur.title},
          description = ${description !== undefined ? description : cur.description},
          due_date    = ${dueDate !== undefined ? dueDate || null : cur.due_date},
          priority    = ${priority !== undefined ? priority : cur.priority},
          category    = ${category !== undefined ? category : cur.category},
          status      = ${status !== undefined ? status : cur.status}
        WHERE id = ${id} AND user_id = ${req.user.id}
        RETURNING id, user_id AS "userId", title, description,
                  due_date AS "dueDate", priority, category, status,
                  created_at AS "createdAt"
      `;
      logInfo('task_updated', { userId: req.user.id, taskId: id, requestId: req.requestId });
      return res.json(rows[0]);
    } catch (error) {
      logError('task_update_failed', error, { userId: req.user.id, taskId: id, requestId: req.requestId });
      return res.status(500).json({ error: 'Erro ao atualizar tarefa' });
    }
  });

  app.delete('/api/tasks/:id', authMiddleware, async (req: any, res) => {
    const { id } = req.params;
    try {
      await sql`DELETE FROM tasks WHERE id = ${id} AND user_id = ${req.user.id}`;
      logInfo('task_deleted', { userId: req.user.id, taskId: id, requestId: req.requestId });
      return res.status(204).send();
    } catch (error) {
      logError('task_delete_failed', error, { userId: req.user.id, taskId: id, requestId: req.requestId });
      return res.status(500).json({ error: 'Erro ao deletar tarefa' });
    }
  });

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

  app.listen(PORT, '0.0.0.0', () => {
    logInfo('server_started', { port: PORT });
  });
}

startServer().catch((error) => {
  logError('server_boot_failed', error);
});
