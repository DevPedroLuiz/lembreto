// IMPORTANTE: dotenv deve ser carregado ANTES de qualquer outro import que use process.env
import { config } from 'dotenv';
config({ path: '.env.local' });

import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Database ──────────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  throw new Error(
    '❌ DATABASE_URL não definida.\n' +
    'Crie o arquivo .env.local na raiz do projeto com:\n' +
    'DATABASE_URL=postgresql://user:senha@host/dbname?sslmode=require'
  );
}

const sql = neon(process.env.DATABASE_URL);
console.log('✅ DATABASE_URL carregada com sucesso.');

// ── Auth Middleware ───────────────────────────────────────────────────────────
const authMiddleware = async (req: any, res: any, next: any) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const rows = await sql`SELECT id, name, email, avatar FROM users WHERE id = ${userId}`;
    if (rows.length === 0) return res.status(401).json({ error: 'Usuário não encontrado' });
    req.user = rows[0];
    next();
  } catch (e: any) {
    console.error('[authMiddleware]', e.message);
    res.status(500).json({ error: 'Erro interno ao autenticar' });
  }
};

// ── Server ────────────────────────────────────────────────────────────────────
async function startServer() {
  const app  = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(express.json({ limit: '10mb' }));

  // ── Auth Routes ──────────────────────────────────────────────────────────────

  // Registro
  app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Preencha todos os campos' });
    }

    try {
      const existing = await sql`SELECT id FROM users WHERE email = ${email.trim().toLowerCase()}`;
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Este email já está em uso' });
      }

      const rows = await sql`
        INSERT INTO users (name, email, password)
        VALUES (${name.trim()}, ${email.trim().toLowerCase()}, ${password})
        RETURNING id, name, email, avatar
      `;
      const user = rows[0];
      console.log('[register] Novo usuário criado:', user.email);
      return res.status(201).json({ user, token: user.id });
    } catch (e: any) {
      console.error('[register]', e.message);
      return res.status(500).json({ error: `Erro ao criar usuário: ${e.message}` });
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
        WHERE email = ${email.trim().toLowerCase()} AND password = ${password}
      `;
      if (rows.length === 0) {
        return res.status(401).json({ error: 'Email ou senha incorretos' });
      }
      return res.json({ user: rows[0], token: rows[0].id });
    } catch (e: any) {
      console.error('[login]', e.message);
      return res.status(500).json({ error: `Erro interno: ${e.message}` });
    }
  });

  // Recuperação de senha (simulada)
  app.post('/api/auth/recover', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Informe o email' });

    try {
      const rows = await sql`SELECT id FROM users WHERE email = ${email.trim().toLowerCase()}`;
      if (rows.length === 0) return res.status(404).json({ error: 'Email não encontrado' });
      return res.json({ message: 'Um link de recuperação foi enviado para seu email.' });
    } catch (e: any) {
      console.error('[recover]', e.message);
      return res.status(500).json({ error: `Erro interno: ${e.message}` });
    }
  });

  // Atualizar perfil
  app.put('/api/auth/profile', authMiddleware, async (req: any, res: any) => {
    const { name, email, password, avatar } = req.body;
    const userId = req.user.id as string;

    try {
      if (email && email.trim().toLowerCase() !== req.user.email) {
        const conflict = await sql`
          SELECT id FROM users WHERE email = ${email.trim().toLowerCase()} AND id != ${userId}
        `;
        if (conflict.length > 0) {
          return res.status(400).json({ error: 'Este email já está em uso' });
        }
      }

      // Busca dados atuais para usar como fallback nos campos não enviados
      const current = await sql`SELECT name, email, password, avatar FROM users WHERE id = ${userId}`;
      if (current.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

      const cur = current[0];
      const newName     = (name     && name.trim())                          || cur.name;
      const newEmail    = (email    && email.trim().toLowerCase())           || cur.email;
      const newPassword = (password && password.trim())                      || cur.password;
      const newAvatar   = avatar !== undefined ? avatar : cur.avatar;

      const rows = await sql`
        UPDATE users
        SET name = ${newName}, email = ${newEmail}, password = ${newPassword}, avatar = ${newAvatar}
        WHERE id = ${userId}
        RETURNING id, name, email, avatar
      `;
      return res.json({ user: rows[0] });
    } catch (e: any) {
      console.error('[profile]', e.message);
      return res.status(500).json({ error: `Erro ao atualizar perfil: ${e.message}` });
    }
  });

  // ── Task Routes ───────────────────────────────────────────────────────────────

  // Listar tarefas
  app.get('/api/tasks', authMiddleware, async (req: any, res: any) => {
    try {
      const rows = await sql`
        SELECT
          id,
          user_id     AS "userId",
          title,
          description,
          due_date    AS "dueDate",
          priority,
          category,
          status,
          created_at  AS "createdAt"
        FROM tasks
        WHERE user_id = ${req.user.id}
        ORDER BY created_at DESC
      `;
      return res.json(rows);
    } catch (e: any) {
      console.error('[GET /tasks]', e.message);
      return res.status(500).json({ error: `Erro ao buscar tarefas: ${e.message}` });
    }
  });

  // Criar tarefa
  app.post('/api/tasks', authMiddleware, async (req: any, res: any) => {
    const { title, description, dueDate, priority, category } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Título obrigatório' });

    try {
      const rows = await sql`
        INSERT INTO tasks (user_id, title, description, due_date, priority, category)
        VALUES (
          ${req.user.id},
          ${title.trim()},
          ${description || ''},
          ${dueDate || null},
          ${priority  || 'medium'},
          ${category  || 'Geral'}
        )
        RETURNING
          id,
          user_id     AS "userId",
          title,
          description,
          due_date    AS "dueDate",
          priority,
          category,
          status,
          created_at  AS "createdAt"
      `;
      return res.status(201).json(rows[0]);
    } catch (e: any) {
      console.error('[POST /tasks]', e.message);
      return res.status(500).json({ error: `Erro ao criar tarefa: ${e.message}` });
    }
  });

  // Atualizar tarefa
  app.put('/api/tasks/:id', authMiddleware, async (req: any, res: any) => {
    const { id } = req.params;
    const { title, description, dueDate, priority, category, status } = req.body;

    try {
      const current = await sql`
        SELECT title, description, due_date, priority, category, status
        FROM tasks WHERE id = ${id} AND user_id = ${req.user.id}
      `;
      if (current.length === 0) return res.status(404).json({ error: 'Tarefa não encontrada' });

      const cur = current[0];
      const rows = await sql`
        UPDATE tasks SET
          title       = ${title       !== undefined ? title.trim()   : cur.title},
          description = ${description !== undefined ? description    : cur.description},
          due_date    = ${dueDate     !== undefined ? dueDate || null : cur.due_date},
          priority    = ${priority    !== undefined ? priority       : cur.priority},
          category    = ${category    !== undefined ? category       : cur.category},
          status      = ${status      !== undefined ? status         : cur.status}
        WHERE id = ${id} AND user_id = ${req.user.id}
        RETURNING
          id,
          user_id     AS "userId",
          title,
          description,
          due_date    AS "dueDate",
          priority,
          category,
          status,
          created_at  AS "createdAt"
      `;
      return res.json(rows[0]);
    } catch (e: any) {
      console.error('[PUT /tasks/:id]', e.message);
      return res.status(500).json({ error: `Erro ao atualizar tarefa: ${e.message}` });
    }
  });

  // Deletar tarefa
  app.delete('/api/tasks/:id', authMiddleware, async (req: any, res: any) => {
    const { id } = req.params;

    try {
      await sql`DELETE FROM tasks WHERE id = ${id} AND user_id = ${req.user.id}`;
      return res.status(204).send();
    } catch (e: any) {
      console.error('[DELETE /tasks/:id]', e.message);
      return res.status(500).json({ error: `Erro ao deletar tarefa: ${e.message}` });
    }
  });

  // ── Vite / Static ─────────────────────────────────────────────────────────────
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
