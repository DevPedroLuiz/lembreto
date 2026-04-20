import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory Database logic
const DB_FILE = path.join(__dirname, 'database.json');
let db: any = { tasks: [], users: [] };

if (fs.existsSync(DB_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    db = { tasks: data.tasks || [], users: data.users || [] };
  } catch(e) {
    console.error('Error reading DB:', e);
  }
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Simple auth middleware (for prototype)
const authMiddleware = (req: any, res: any, next: any) => {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = db.users.find((u: any) => u.id === userId);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  next();
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- Auth Routes ---
  app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Fields required' });
    }
    if (db.users.find((u: any) => u.email === email)) {
      return res.status(400).json({ error: 'Email already in use' });
    }
    const newUser = { id: uuidv4(), name, email, password }; // In production: hash password
    db.users.push(newUser);
    saveDb();
    
    // Auto-login after register
    res.status(201).json({ user: { id: newUser.id, name: newUser.name, email: newUser.email, avatar: null }, token: newUser.id });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const user = db.users.find((u: any) => u.email === email && u.password === password);
    if (!user) {
      return res.status(401).json({ error: 'Invaild credentials' });
    }
    res.json({ user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar || null }, token: user.id });
  });

  app.post('/api/auth/recover', (req, res) => {
    const { email } = req.body;
    const user = db.users.find((u: any) => u.email === email);
    if (!user) {
      return res.status(404).json({ error: 'Email não encontrado' });
    }
    // Simulate sending recovery email
    res.json({ message: 'Um link de recuperação foi enviado para seu E-mail.' });
  });

  app.put('/api/auth/profile', authMiddleware, (req: any, res: any) => {
    const { name, email, password, avatar } = req.body;
    const user = db.users.find((u: any) => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (email && email !== user.email && db.users.find((u: any) => u.email === email)) {
      return res.status(400).json({ error: 'Email já está em uso.' });
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (password) user.password = password;
    if (avatar !== undefined) user.avatar = avatar;

    saveDb();
    res.json({ user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar } });
  });


  // --- Task Routes (Protected) ---
  app.get('/api/tasks', authMiddleware, (req: any, res: any) => {
    const userTasks = db.tasks.filter((t: any) => t.userId === req.user.id);
    res.json(userTasks);
  });

  app.post('/api/tasks', authMiddleware, (req: any, res: any) => {
    const { title, description, dueDate, priority, category } = req.body;
    const newTask = {
      id: uuidv4(),
      userId: req.user.id,
      title,
      description: description || '',
      dueDate,
      priority: priority || 'medium',
      category: category || 'geral',
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    db.tasks.push(newTask);
    saveDb();
    res.status(201).json(newTask);
  });

  app.put('/api/tasks/:id', authMiddleware, (req: any, res: any) => {
    const { id } = req.params;
    const taskIndex = db.tasks.findIndex((t: any) => t.id === id && t.userId === req.user.id);
    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const updatedTask = { ...db.tasks[taskIndex], ...req.body };
    db.tasks[taskIndex] = updatedTask;
    saveDb();
    res.json(updatedTask);
  });

  app.delete('/api/tasks/:id', authMiddleware, (req: any, res: any) => {
    const { id } = req.params;
    const taskIndex = db.tasks.findIndex((t: any) => t.id === id && t.userId === req.user.id);
    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }
    db.tasks.splice(taskIndex, 1);
    saveDb();
    res.status(204).send();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // For Express 4.x we use *
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
