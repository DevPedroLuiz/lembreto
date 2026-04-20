import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Database ────────────────────────────────────────────────────────────────
const DB_FILE = path.join(__dirname, 'database.json');
let db: { tasks: any[]; users: any[] } = { tasks: [], users: [] };

if (fs.existsSync(DB_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    db = { tasks: data.tasks || [], users: data.users || [] };
  } catch (e) {
    console.error('Erro ao ler banco de dados:', e);
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('Erro ao salvar banco de dados:', e);
  }
}

// ── Auth Middleware ──────────────────────────────────────────────────────────
const authMiddleware = (req: any, res: any, next: any) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });
  const user = db.users.find((u: any) => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
  req.user = user;
  next();
};

// ── Server ───────────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(express.json({ limit: '10mb' })); // Permite avatares base64

  // ── Auth Routes ─────────────────────────────────────────────────────────
  app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Preencha todos os campos' });
    }
    if (db.users.find((u: any) => u.email === email)) {
      return res.status(400).json({ error: 'Este email já está em uso' });
    }
    const newUser = { id: uuidv4(), name, email, password, avatar: null };
    db.users.push(newUser);
    saveDb();
    res.status(201).json({
      user: { id: newUser.id, name: newUser.name, email: newUser.email, avatar: null },
      token: newUser.id,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Preencha todos os campos' });
    }
    const user = db.users.find((u: any) => u.email === email && u.password === password);
    if (!user) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }
    res.json({
      user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar || null },
      token: user.id,
    });
  });

  app.post('/api/auth/recover', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Informe o email' });
    const user = db.users.find((u: any) => u.email === email);
    if (!user) return res.status(404).json({ error: 'Email não encontrado' });
    res.json({ message: 'Um link de recuperação foi enviado para seu email.' });
  });

  app.put('/api/auth/profile', authMiddleware, (req: any, res: any) => {
    const { name, email, password, avatar } = req.body;
    const user = db.users.find((u: any) => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    if (email && email !== user.email && db.users.find((u: any) => u.email === email)) {
      return res.status(400).json({ error: 'Este email já está em uso' });
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (password) user.password = password;
    if (avatar !== undefined) user.avatar = avatar;

    saveDb();
    res.json({ user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar } });
  });

  // ── Task Routes ─────────────────────────────────────────────────────────
  app.get('/api/tasks', authMiddleware, (req: any, res: any) => {
    const userTasks = db.tasks.filter((t: any) => t.userId === req.user.id);
    res.json(userTasks);
  });

  app.post('/api/tasks', authMiddleware, (req: any, res: any) => {
    const { title, description, dueDate, priority, category } = req.body;
    if (!title) return res.status(400).json({ error: 'Título obrigatório' });
    const newTask = {
      id: uuidv4(),
      userId: req.user.id,
      title,
      description: description || '',
      dueDate,
      priority: priority || 'medium',
      category: category || 'Geral',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    db.tasks.push(newTask);
    saveDb();
    res.status(201).json(newTask);
  });

  app.put('/api/tasks/:id', authMiddleware, (req: any, res: any) => {
    const { id } = req.params;
    const idx = db.tasks.findIndex((t: any) => t.id === id && t.userId === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'Tarefa não encontrada' });
    db.tasks[idx] = { ...db.tasks[idx], ...req.body };
    saveDb();
    res.json(db.tasks[idx]);
  });

  app.delete('/api/tasks/:id', authMiddleware, (req: any, res: any) => {
    const { id } = req.params;
    const idx = db.tasks.findIndex((t: any) => t.id === id && t.userId === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'Tarefa não encontrada' });
    db.tasks.splice(idx, 1);
    saveDb();
    res.status(204).send();
  });

  // ── Vite / Static ────────────────────────────────────────────────────────
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
