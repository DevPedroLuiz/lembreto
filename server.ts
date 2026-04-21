import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Database ─────────────────────────────────────────────────────────────────
// DATABASE_URL é injetada automaticamente pela integração Neon ↔ Vercel.
// Para desenvolvimento local, crie um arquivo .env.local com:
//   DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não está definida. Configure a integração Neon no Vercel.');
}

const sql = neon(process.env.DATABASE_URL);

// ── Auth Middleware ───────────────────────────────────────────────────────────
const authMiddleware = async (req: any, res: any, next: any) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const rows = await sql`SELECT id, name, email, avatar FROM users WHERE id = ${userId}`;
    if (rows.length === 0) return res.status(401).json({ error: 'Usuário não encontrado' });
    req.user = rows[0];
    next();
  } catch {
    res.status(500).json({ error: 'Erro interno ao autenticar' });
  }
};

// ── Server ────────────────────────────────────────────────────────────────────
async function startServer() {
  const app  = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(express.json({ limit: '10mb' }));

  // ── Auth Routes ─────────────────────────────────────────────────────────────

  // Registro
  app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Preencha todos os campos' });
    }

    try {
      const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Este email já está em uso' });
      }

      const rows = await sql`
        INSERT INTO users (name, email, password)
        VALUES (${name.trim()}, ${email}, ${password})
        RETURNING id, name, email, avatar
      `;
      const user = rows[0];
      res.status(201).json({ user, token: user.id });
    } catch (e: any) {
      res.status(500).json({ error: 'Erro ao criar usuário' });
    }
  });

  // Login
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Preencha todos os campos' });
    }

    try {
      const rows = await sql`
        SELECT id, name, email, avatar
        FROM users
        WHERE email = ${email} AND password = ${password}
      `;
      if (rows.length === 0) {
        return res.status(401).json({ error: 'Email ou senha incorretos' });
      }
      const user = rows[0];
      res.json({ user, token: user.id });
    } catch {
      res.status(500).json({ error: 'Erro interno' });
    }
  });

  // Recuperação de senha (simulada — sem envio real de e-mail)
  app.post('/api/auth/recover', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Informe o email' });

    try {
      const rows = await sql`SELECT id FROM users WHERE email = ${email}`;
      if (rows.length === 0) return res.status(404).json({ error: 'Email não encontrado' });
      res.json({ message: 'Um link de recuperação foi enviado para seu email.' });
    } catch {
      res.status(500).json({ error: 'Erro interno' });
    }
  });

  // Atualizar perfil
  app.put('/api/auth/profile', authMiddleware, async (req: any, res: any) => {
    const { name, email, password, avatar } = req.body;
    const userId = req.user.id;

    try {
      if (email && email !== req.user.email) {
        const conflict = await sql`SELECT id FROM users WHERE email = ${email} AND id != ${userId}`;
        if (conflict.length > 0) {
          return res.status(400).json({ error: 'Este email já está em uso' });
        }
      }

      const rows = await sql`
        UPDATE users SET
          name     = COALESCE(${name   ?? null}, name),
          email    = COALESCE(${email  ?? null}, email),
          password = COALESCE(${password ?? null}, password),
          avatar   = COALESCE(${avatar  ?? null}, avatar)
        WHERE id = ${userId}
        RETURNING id, name, email, avatar
      `;
      res.json({ user: rows[0] });
    } catch {
      res.status(500).json({ error: 'Erro ao atualizar perfil' });
    }
  });

  // ── Task Routes ─────────────────────────────────────────────────────────────

  // Listar tarefas do usuário
  app.get('/api/tasks', authMiddleware, async (req: any, res: any) => {
    try {
      const rows = await sql`
        SELECT
          id, user_id AS "userId", title, description,
          due_date AS "dueDate", priority, category, status,
          created_at AS "createdAt"
        FROM tasks
        WHERE user_id = ${req.user.id}
        ORDER BY created_at DESC
      `;
      res.json(rows);
    } catch {
      res.status(500).json({ error: 'Erro ao buscar tarefas' });
    }
  });

  // Criar tarefa
  app.post('/api/tasks', authMiddleware, async (req: any, res: any) => {
    const { title, description, dueDate, priority, category } = req.body;
    if (!title) return res.status(400).json({ error: 'Título obrigatório' });

    try {
      const rows = await sql`
        INSERT INTO tasks (user_id, title, description, due_date, priority, category)
        VALUES (
          ${req.user.id},
          ${title},
          ${description || ''},
          ${dueDate ?? null},
          ${priority || 'medium'},
          ${category || 'Geral'}
        )
        RETURNING
          id, user_id AS "userId", title, description,
          due_date AS "dueDate", priority, category, status,
          created_at AS "createdAt"
      `;
      res.status(201).json(rows[0]);
    } catch {
      res.status(500).json({ error: 'Erro ao criar tarefa' });
    }
  });

  // Atualizar tarefa
  app.put('/api/tasks/:id', authMiddleware, async (req: any, res: any) => {
    const { id } = req.params;
    const { title, description, dueDate, priority, category, status } = req.body;

    try {
      const rows = await sql`
        UPDATE tasks SET
          title       = COALESCE(${title       ?? null}, title),
          description = COALESCE(${description ?? null}, description),
          due_date    = COALESCE(${dueDate     ?? null}, due_date),
          priority    = COALESCE(${priority    ?? null}, priority),
          category    = COALESCE(${category    ?? null}, category),
          status      = COALESCE(${status      ?? null}, status)
        WHERE id = ${id} AND user_id = ${req.user.id}
        RETURNING
          id, user_id AS "userId", title, description,
          due_date AS "dueDate", priority, category, status,
          created_at AS "createdAt"
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'Tarefa não encontrada' });
      res.json(rows[0]);
    } catch {
      res.status(500).json({ error: 'Erro ao atualizar tarefa' });
    }
  });

  // Deletar tarefa
  app.delete('/api/tasks/:id', authMiddleware, async (req: any, res: any) => {
    const { id } = req.params;

    try {
      const result = await sql`
        DELETE FROM tasks WHERE id = ${id} AND user_id = ${req.user.id}
      `;
      // @ts-ignore — neon retorna rowCount em deletes
      if (result.rowCount === 0) return res.status(404).json({ error: 'Tarefa não encontrada' });
      res.status(204).send();
    } catch {
      res.status(500).json({ error: 'Erro ao deletar tarefa' });
    }
  });

  // ── Vite / Static ────────────────────────────────────────────────────────────
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
    console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
