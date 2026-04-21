import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2, Circle, Clock, Plus, Trash2, Bell, Search, Moon,
  LayoutDashboard, ListTodo, CalendarDays, Target, Sparkles,
  BellRing, LogOut, Mail, Lock, User as UserIcon, X, Tag,
  ChevronRight, ArrowRight, Settings, Volume2, ShieldAlert, Camera
} from 'lucide-react';
import { format, isPast, isToday, isTomorrow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Priority = 'low' | 'medium' | 'high';
export type Status = 'pending' | 'completed';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  dueDate: string;
  priority: Priority;
  category: string;
  status: Status;
  createdAt: string;
}

const CATEGORIES = ["Geral", "Trabalho", "Pessoal", "Estudos"];

// ── localStorage — armazena APENAS dados não-sensíveis ────────────────────────
// O JWT NUNCA é persistido. Ele vive exclusivamente em memória (useState).
// Consequência intencional: ao recarregar a página o usuário precisa fazer login
// novamente. Isso é a troca de segurança contra ataques XSS via localStorage.
const LS = {
  // Salva apenas os dados de exibição do usuário — sem token
  saveUser: (user: User) =>
    localStorage.setItem('tm_user', JSON.stringify(user)),
  loadUser: (): User | null => {
    try {
      const r = localStorage.getItem('tm_user');
      return r ? JSON.parse(r) : null;
    } catch { return null; }
  },
  clearUser: () => localStorage.removeItem('tm_user'),
  getConfig: () => {
    try { return JSON.parse(localStorage.getItem('tm_config') || '{}'); } catch { return {}; }
  },
  saveConfig: (cfg: object) => localStorage.setItem('tm_config', JSON.stringify(cfg)),
};

// ── API Helpers ───────────────────────────────────────────────────────────────
// Token vai no header Authorization: Bearer <jwt> — nunca em query string ou body
const buildHeaders = (token?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

async function apiPost(path: string, body: object, token?: string) {
  const res = await fetch(path, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
  return data;
}

async function apiPut(path: string, body: object, token: string) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
  return data;
}

async function apiGet(path: string, token: string) {
  const res = await fetch(path, { headers: buildHeaders(token) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
  return data;
}

async function apiDelete(path: string, token: string) {
  const res = await fetch(path, {
    method: 'DELETE',
    headers: buildHeaders(token),
  });
  if (res.status !== 204 && !res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Erro ao deletar');
  }
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // token vive APENAS em memória — nunca em localStorage/sessionStorage/cookie
  const [token, setToken] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tasks'>('dashboard');
  const [filterCategory, setFilterCategory] = useState<string>('Todas');
  const [search, setSearch] = useState('');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>('default');
  const [toastMsg, setToastMsg] = useState<{ title: string; message: string } | null>(null);

  // Profile
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profName, setProfName] = useState('');
  const [profEmail, setProfEmail] = useState('');
  const [profPassword, setProfPassword] = useState('');
  const [profAvatar, setProfAvatar] = useState<string | null>(null);

  // Auth
  const [isLogin, setIsLogin] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [configSound, setConfigSound] = useState(true);
  const [configConfirmDelete, setConfigConfirmDelete] = useState(true);
  const [configShowCompleted, setConfigShowCompleted] = useState(true);

  // Task Form
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formPriority, setFormPriority] = useState<Priority>('medium');
  const [formCategory, setFormCategory] = useState<string>('Geral');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // Recupera apenas os dados de exibição do usuário (sem token)
    // O token não existe mais após reload — o usuário precisará fazer login
    const savedUser = LS.loadUser();
    if (savedUser) {
      // Exibe os dados do usuário salvo enquanto não há token
      // O app mostrará a tela de login pois token === null
      // Pré-preenche o e-mail para agilizar o re-login
      setAuthEmail(savedUser.email);
    }

    const cfg = LS.getConfig() as any;
    if (cfg.sound !== undefined) setConfigSound(cfg.sound);
    if (cfg.confirmDelete !== undefined) setConfigConfirmDelete(cfg.confirmDelete);
    if (cfg.showCompleted !== undefined) setConfigShowCompleted(cfg.showCompleted);

    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) setDarkMode(true);

    if ('Notification' in window) {
      setNotifPerm(Notification.permission);
      if (Notification.permission === 'default') {
        const t = setTimeout(() => Notification.requestPermission().then(setNotifPerm), 5000);
        return () => clearTimeout(t);
      }
    }
  }, []);

  // Carrega tarefas quando token estiver disponível
  useEffect(() => {
    if (!token) return;
    apiGet('/api/tasks', token)
      .then(data => { if (Array.isArray(data)) setTasks(data); })
      .catch(() => setTasks([]));
  }, [token]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const showToast = useCallback((title: string, message: string) => {
    setToastMsg({ title, message });
    setTimeout(() => setToastMsg(null), 4000);
  }, []);

  const notify = useCallback((title: string, body: string) => {
    if (notifPerm === 'granted') new Notification(title, { body });
    showToast(title, body);
  }, [notifPerm, showToast]);

  const playSuccessSound = () => {
    if (!configSound) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch { /* ignore */ }
  };

  const saveConfig = (patch: Partial<{ sound: boolean; confirmDelete: boolean; showCompleted: boolean }>) => {
    const next = { sound: configSound, confirmDelete: configConfirmDelete, showCompleted: configShowCompleted, ...patch };
    setConfigSound(next.sound);
    setConfigConfirmDelete(next.confirmDelete);
    setConfigShowCompleted(next.showCompleted);
    LS.saveConfig(next);
  };

  // ── Auth ──────────────────────────────────────────────────────────────────
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const payload = isLogin
      ? { email: authEmail, password: authPassword }
      : { name: authName.trim(), email: authEmail, password: authPassword };

    try {
      const data = await apiPost(endpoint, payload);

      // Token fica apenas em memória — nunca vai ao localStorage
      setToken(data.token);
      setCurrentUser(data.user);

      // Persiste apenas os dados de exibição (nome, e-mail, avatar)
      LS.saveUser(data.user);

      setAuthName(''); setAuthEmail(''); setAuthPassword('');
      notify('Bem-vindo!', `Olá, ${data.user.name}!`);
    } catch (err: any) {
      setAuthError(err.message || 'Falha na comunicação com o servidor.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const data = await apiPost('/api/auth/recover', { email: recoverEmail });
      notify('Recuperação', data.message);
      setIsRecovering(false);
      setRecoverEmail('');
    } catch (err: any) {
      setAuthError(err.message || 'Erro ao recuperar senha.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout: invalida o token no servidor, depois limpa memória e localStorage
  const handleLogout = async () => {
    if (token) {
      // Fire-and-forget — não bloqueia o logout local
      // O token expira em 7 dias de qualquer forma
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: buildHeaders(token),
      }).catch(() => { /* ignora falha de rede */ });
    }

    LS.clearUser();
    setCurrentUser(null);
    setToken(null);       // destrói o JWT da memória
    setTasks([]);
    setActiveTab('dashboard');
  };

  // ── Profile ───────────────────────────────────────────────────────────────
  const openProfile = () => {
    setProfName(currentUser?.name || '');
    setProfEmail(currentUser?.email || '');
    setProfPassword('');
    setProfAvatar(currentUser?.avatar || null);
    setShowProfileForm(true);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setProfAvatar(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      const data = await apiPut('/api/auth/profile', {
        name: profName,
        email: profEmail,
        password: profPassword || undefined,
        avatar: profAvatar,
      }, token);
      setCurrentUser(data.user);
      // Atualiza os dados de exibição no localStorage (sem token)
      LS.saveUser(data.user);
      notify('Perfil atualizado!', 'Suas informações foram salvas.');
      setShowProfileForm(false);
    } catch (err: any) {
      notify('Erro', err.message || 'Falha ao atualizar perfil.');
    }
  };

  // ── Tasks ─────────────────────────────────────────────────────────────────
  const handleSubmitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formDate || !token) return;

    if (isPast(new Date(formDate)) && !isToday(new Date(formDate))) {
      notify('Atenção', 'A data estipulada já passou.');
    }

    const taskData = {
      title: formTitle,
      description: formDesc,
      dueDate: new Date(formDate).toISOString(),
      priority: formPriority,
      category: formCategory,
    };

    try {
      if (editingTaskId) {
        const updated = await apiPut(`/api/tasks/${editingTaskId}`, taskData, token);
        setTasks(prev => prev.map(t => t.id === editingTaskId ? updated : t));
        notify('Atualizada!', 'Sua tarefa foi modificada.');
      } else {
        const created = await apiPost('/api/tasks', taskData, token);
        setTasks(prev => [...prev, created]);
        notify('Tarefa criada!', `"${created.title}" foi adicionada.`);
      }
      resetForm();
    } catch (err: any) {
      notify('Erro', err.message || 'Falha ao salvar tarefa.');
    }
  };

  const resetForm = () => {
    setFormTitle(''); setFormDesc(''); setFormDate('');
    setFormPriority('medium'); setFormCategory('Geral');
    setEditingTaskId(null); setShowTaskForm(false);
  };

  const handleNewTaskInit = () => { resetForm(); setShowTaskForm(true); };

  const handleEditInit = (task: Task) => {
    setFormTitle(task.title);
    setFormDesc(task.description);
    setFormDate(task.dueDate.slice(0, 16));
    setFormPriority(task.priority);
    setFormCategory(task.category || 'Geral');
    setEditingTaskId(task.id);
    setShowTaskForm(true);
  };

  const toggleTaskStatus = async (task: Task) => {
    if (!token) return;
    const newStatus: Status = task.status === 'pending' ? 'completed' : 'pending';
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    try {
      await apiPut(`/api/tasks/${task.id}`, { status: newStatus }, token);
      if (newStatus === 'completed') {
        playSuccessSound();
        notify('Parabéns!', `"${task.title}" concluída!`);
      }
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t));
    }
  };

  const deleteTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token) return;
    if (configConfirmDelete && !window.confirm('Deseja excluir esta tarefa permanentemente?')) return;
    setTasks(prev => prev.filter(t => t.id !== id));
    try {
      await apiDelete(`/api/tasks/${id}`, token);
      showToast('Removida', 'A tarefa foi deletada.');
    } catch (err: any) {
      notify('Erro', err.message || 'Falha ao deletar.');
    }
  };

  // ── Derived Data ──────────────────────────────────────────────────────────
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const completedTasks = tasks.filter(t => t.status === 'completed');
  const filteredTasks = pendingTasks.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = filterCategory === 'Todas' || t.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const totalTasks = tasks.length;
  const completedCount = completedTasks.length;
  const todayCount = pendingTasks.filter(t => { try { return isToday(parseISO(t.dueDate)); } catch { return false; } }).length;
  const overdueCount = pendingTasks.filter(t => { try { return isPast(parseISO(t.dueDate)) && !isToday(parseISO(t.dueDate)); } catch { return false; } }).length;

  // ── Auth Screen ───────────────────────────────────────────────────────────
  // Mostra login se não há token em memória (mesmo que haja dados de usuário salvos)
  if (!currentUser || !token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-[#040814]">
        <div className="max-w-md w-full bg-white dark:bg-[#0a122a] rounded-3xl p-8 shadow-2xl border border-slate-200 dark:border-white/10">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-4 text-white shadow-lg shadow-blue-500/20">
              <Target size={32} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Lembreto</h1>
            <p className="text-slate-500 mt-2 text-sm">
              {isRecovering ? 'Recuperar senha' : isLogin ? 'Faça login para continuar' : 'Crie sua conta'}
            </p>
          </div>

          {isRecovering ? (
            <form onSubmit={handleRecover} className="space-y-4">
              <p className="text-sm text-slate-500 text-center">Informe seu email para recuperar sua senha.</p>
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input required type="email" placeholder="Seu email" value={recoverEmail}
                  onChange={e => setRecoverEmail(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm" />
              </div>
              {authError && <p className="text-rose-500 text-sm text-center font-medium">{authError}</p>}
              <button type="submit" disabled={authLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-2xl py-3.5 font-bold transition-all active:scale-95">
                {authLoading ? 'Enviando...' : 'Recuperar Senha'}
              </button>
              <p className="text-center text-sm">
                <button type="button" onClick={() => { setIsRecovering(false); setAuthError(''); }}
                  className="text-blue-600 font-semibold hover:underline">Voltar ao login</button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleAuth} className="space-y-4">
              {!isLogin && (
                <div className="relative">
                  <UserIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input required type="text" placeholder="Seu nome completo" value={authName}
                    onChange={e => setAuthName(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm" />
                </div>
              )}
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input required type="email" placeholder="Email" value={authEmail}
                  onChange={e => setAuthEmail(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm" />
              </div>
              <div className="relative">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input required type="password" placeholder="Senha" value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm" />
              </div>
              {isLogin && (
                <div className="text-right">
                  <button type="button" onClick={() => { setIsRecovering(true); setAuthError(''); }}
                    className="text-blue-600 text-sm font-semibold hover:underline">Esqueceu a senha?</button>
                </div>
              )}
              {authError && <p className="text-rose-500 text-sm text-center font-medium">{authError}</p>}
              <button type="submit" disabled={authLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-2xl py-3.5 font-bold shadow-lg shadow-blue-500/20 active:scale-95 transition-all">
                {authLoading ? 'Aguarde...' : isLogin ? 'Entrar' : 'Criar Conta'}
              </button>
              <p className="text-center text-slate-500 text-sm">
                {isLogin ? 'Não tem uma conta?' : 'Já possui uma conta?'}{' '}
                <button type="button" onClick={() => { setIsLogin(!isLogin); setAuthError(''); }}
                  className="text-blue-600 font-bold hover:underline">
                  {isLogin ? 'Registre-se' : 'Faça login'}
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ── Main App ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-[#02040a] text-slate-900 dark:text-slate-100 overflow-hidden font-sans">

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-72 h-full border-r border-slate-200/60 dark:border-white/5 bg-white/50 dark:bg-[#0a0f1e]/80 backdrop-blur-xl shrink-0 p-6">
        <div className="flex items-center gap-3 px-2 mb-10">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-sky-400 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
            <Target size={22} />
          </div>
          <h1 className="font-bold text-xl tracking-tight">Lembreto</h1>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={20} />} label="Dashboard" />
          <SidebarItem active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} icon={<ListTodo size={20} />} label="Minhas Tarefas" badge={pendingTasks.length} />

          <div className="pt-8 pb-3 px-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Categorias</h3>
          </div>
          <FilterTag active={filterCategory === 'Todas'} onClick={() => { setFilterCategory('Todas'); setActiveTab('tasks'); }} label="Todas" count={pendingTasks.length} />
          {CATEGORIES.map(cat => (
            <FilterTag key={cat} active={filterCategory === cat} onClick={() => { setFilterCategory(cat); setActiveTab('tasks'); }} label={cat} count={pendingTasks.filter(t => t.category === cat).length} />
          ))}
        </nav>

        <div className="mt-auto pt-6 space-y-4">
          <div onClick={openProfile} className="bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 cursor-pointer transition-colors rounded-2xl p-4 flex items-center gap-3">
            {currentUser.avatar ? (
              <img src={currentUser.avatar} alt="Avatar" className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center shrink-0">
                <UserIcon size={20} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{currentUser.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{currentUser.email}</p>
            </div>
            <button onClick={e => { e.stopPropagation(); handleLogout(); }} className="text-slate-400 hover:text-rose-500 transition-colors shrink-0" title="Sair">
              <LogOut size={18} />
            </button>
          </div>

          <button onClick={() => setShowSettings(true)} className="flex items-center justify-between w-full px-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 transition-colors">
            <span className="text-sm font-medium flex items-center gap-2"><Settings size={16} /> Configurações</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto overflow-x-hidden bg-slate-50 dark:bg-transparent">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-slate-200/60 dark:border-white/5 bg-white/70 dark:bg-[#0a0f1e]/80 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <Target size={22} className="text-blue-500" />
            <h1 className="font-bold text-lg">Lembreto</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSettings(true)} className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors">
              <Settings size={20} />
            </button>
            <button onClick={openProfile} className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center border-2 border-transparent hover:border-blue-500 transition-all overflow-hidden">
              {currentUser.avatar ? <img src={currentUser.avatar} alt="Avatar" className="w-full h-full object-cover" /> : <UserIcon size={16} />}
            </button>
          </div>
        </header>

        <div className="flex-1 p-4 md:p-10 max-w-7xl w-full mx-auto pb-28 md:pb-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
            <div>
              <h2 className="text-3xl font-bold mb-1">
                {activeTab === 'dashboard' ? `Olá, ${currentUser.name.split(' ')[0]}` : 'Suas Atividades'}
              </h2>
              <p className="text-slate-500 dark:text-slate-400">
                {activeTab === 'dashboard' ? 'Aqui está o panorama do seu dia.' : 'Gerencie e organize suas prioridades.'}
              </p>
            </div>
            {activeTab === 'tasks' && (
              <button onClick={handleNewTaskInit} className="hidden md:flex items-center gap-2 bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:opacity-90 px-6 py-3 rounded-2xl font-semibold shadow-xl active:scale-95 transition-all">
                <Plus size={20} /> Nova Tarefa
              </button>
            )}
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div key="dash" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-10">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                  <MetricCard title="Total" value={totalTasks} icon={<Target size={20} />} />
                  <MetricCard title="Feitas" value={completedCount} icon={<CheckCircle2 size={20} />} />
                  <MetricCard title="Hoje" value={todayCount} icon={<CalendarDays size={20} />} />
                  <MetricCard title="Atrasadas" value={overdueCount} icon={<Bell size={20} />} error />
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-semibold">Pendentes</h3>
                      <button onClick={() => setActiveTab('tasks')} className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                        Ver todas <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="bg-white/50 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 rounded-[2rem] p-4 space-y-3">
                      {pendingTasks.slice(0, 5).map(task => (
                        <TaskItem key={task.id} task={task} onToggle={toggleTaskStatus} onDelete={deleteTask} onEdit={handleEditInit} compact />
                      ))}
                      {pendingTasks.length === 0 && (
                        <div className="py-16 text-center opacity-60">
                          <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-500" />
                          <p className="font-medium">Nenhuma pendência.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-slate-900 dark:bg-[#131b2f] rounded-[2rem] p-8 text-white relative overflow-hidden flex flex-col min-h-[280px]">
                    <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none"><Sparkles size={100} /></div>
                    <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-widest border border-white/10 w-fit">Progresso</span>
                    <div className="mt-auto z-10">
                      <h3 className="text-5xl font-light mt-8 mb-2">{completedCount} <span className="text-slate-400 text-2xl">/ {totalTasks}</span></h3>
                      <p className="text-slate-400 text-sm mb-6">Tarefas completadas.</p>
                      <button onClick={handleNewTaskInit} className="w-full bg-white text-slate-900 font-bold py-4 rounded-2xl hover:bg-slate-100 transition-all active:scale-95">
                        Nova Meta
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'tasks' && (
              <motion.div key="tasks" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <div className="flex flex-col md:flex-row gap-4 mb-8">
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input type="text" placeholder="Buscar tarefas..." value={search} onChange={e => setSearch(e.target.value)}
                      className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="md:hidden flex overflow-x-auto gap-2 pb-1">
                    <FilterTag active={filterCategory === 'Todas'} onClick={() => setFilterCategory('Todas')} label="Todas" />
                    {CATEGORIES.map(cat => (
                      <FilterTag key={cat} active={filterCategory === cat} onClick={() => setFilterCategory(cat)} label={cat} />
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <AnimatePresence>
                    {filteredTasks.length > 0 ? filteredTasks.map(task => (
                      <TaskItem key={task.id} task={task} onToggle={toggleTaskStatus} onDelete={deleteTask} onEdit={handleEditInit} />
                    )) : (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20 bg-white/30 dark:bg-white/5 border border-dashed border-slate-200 dark:border-white/10 rounded-3xl">
                        <Sparkles size={32} className="mx-auto mb-4 text-slate-400" />
                        <h3 className="text-lg font-semibold mb-2">Nada por aqui</h3>
                        <p className="text-slate-500 mb-6">Nenhuma tarefa encontrada.</p>
                        <button onClick={handleNewTaskInit} className="px-6 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-semibold active:scale-95 transition-transform">
                          Criar Tarefa
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {configShowCompleted && filterCategory === 'Todas' && !search && completedTasks.length > 0 && (
                  <div className="mt-12 opacity-60">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-4">
                      Concluídas ({completedTasks.length})
                    </h3>
                    <div className="space-y-3">
                      {completedTasks.map(task => (
                        <TaskItem key={task.id} task={task} onToggle={toggleTaskStatus} onDelete={deleteTask} onEdit={handleEditInit} isCompletedSection />
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* ── Task Drawer ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showTaskForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={resetForm} className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[100]" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-[#040814] shadow-2xl z-[101] border-l border-slate-200 dark:border-white/10 flex flex-col">
              <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0">
                <h2 className="text-xl font-semibold">{editingTaskId ? 'Editar Tarefa' : 'Nova Tarefa'}</h2>
                <button onClick={resetForm} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <form id="task-form" onSubmit={handleSubmitTask} className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Título</label>
                    <input autoFocus required type="text" placeholder="Ex: Preparar relatório" value={formTitle}
                      onChange={e => setFormTitle(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Prazo</label>
                    <div className="relative">
                      <CalendarDays className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                      <input type="datetime-local" required value={formDate} onChange={e => setFormDate(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        style={{ colorScheme: darkMode ? 'dark' : 'light' }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Prioridade</label>
                      <select value={formPriority} onChange={e => setFormPriority(e.target.value as Priority)}
                        className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">
                        <option value="low">Baixa</option>
                        <option value="medium">Média</option>
                        <option value="high">Alta</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Categoria</label>
                      <select value={formCategory} onChange={e => setFormCategory(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Detalhes (Opcional)</label>
                    <textarea placeholder="Notas, links..." value={formDesc} onChange={e => setFormDesc(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 min-h-[120px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </form>
              </div>
              <div className="p-6 border-t border-slate-100 dark:border-white/5 shrink-0">
                <button form="task-form" type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/20 active:scale-95 transition-all">
                  {editingTaskId ? 'Salvar Alterações' : 'Adicionar Tarefa'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Profile Drawer ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showProfileForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowProfileForm(false)} className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[100]" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-[#040814] shadow-2xl z-[101] border-l border-slate-200 dark:border-white/10 flex flex-col">
              <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0">
                <h2 className="text-xl font-semibold">Editar Perfil</h2>
                <button onClick={() => setShowProfileForm(false)} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <form id="profile-form" onSubmit={handleUpdateProfile} className="space-y-6">
                  <div className="flex justify-center">
                    <div className="relative group cursor-pointer">
                      {profAvatar ? (
                        <img src={profAvatar} alt="Avatar" className="w-24 h-24 rounded-full object-cover border-4 border-white dark:border-[#040814] shadow-md" />
                      ) : (
                        <div className="w-24 h-24 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center border-4 border-white dark:border-[#040814]">
                          <UserIcon size={36} />
                        </div>
                      )}
                      <label className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                        <Camera size={20} className="text-white" />
                        <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Nome</label>
                    <input required type="text" value={profName} onChange={e => setProfName(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Email</label>
                    <input required type="email" value={profEmail} onChange={e => setProfEmail(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Nova Senha (Opcional)</label>
                    <input type="password" placeholder="Deixe em branco para manter" value={profPassword} onChange={e => setProfPassword(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium" />
                  </div>
                </form>
              </div>
              <div className="p-6 border-t border-slate-100 dark:border-white/5 shrink-0 space-y-3">
                <button form="profile-form" type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/20 active:scale-95 transition-all">
                  Salvar Perfil
                </button>
                <button onClick={() => { setShowProfileForm(false); handleLogout(); }} type="button"
                  className="w-full md:hidden flex items-center justify-center gap-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 font-bold py-3.5 rounded-2xl transition-all">
                  <LogOut size={18} /> Sair da Conta
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Settings Drawer ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)} className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[100]" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-sm bg-white dark:bg-[#040814] shadow-2xl z-[101] border-l border-slate-200 dark:border-white/10 flex flex-col">
              <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0">
                <h2 className="text-xl font-semibold flex items-center gap-2"><Settings size={20} className="text-blue-500" /> Configurações</h2>
                <button onClick={() => setShowSettings(false)} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Moon size={14} /> Aparência</h3>
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                    <span className="font-semibold text-sm">Modo Escuro</span>
                    <Toggle active={darkMode} onClick={() => setDarkMode(!darkMode)} />
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2"><LayoutDashboard size={14} /> Comportamento</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                      <span className="font-semibold text-sm flex items-center gap-2"><Volume2 size={16} className="text-slate-400" /> Efeitos Sonoros</span>
                      <Toggle active={configSound} onClick={() => saveConfig({ sound: !configSound })} />
                    </div>
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                      <span className="font-semibold text-sm flex items-center gap-2"><ShieldAlert size={16} className="text-slate-400" /> Confirmar Exclusão</span>
                      <Toggle active={configConfirmDelete} onClick={() => saveConfig({ confirmDelete: !configConfirmDelete })} />
                    </div>
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                      <span className="font-semibold text-sm flex items-center gap-2"><CheckCircle2 size={16} className="text-slate-400" /> Exibir Concluídas</span>
                      <Toggle active={configShowCompleted} onClick={() => saveConfig({ showCompleted: !configShowCompleted })} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-slate-100 dark:border-white/5 shrink-0">
                <p className="text-xs text-center text-slate-400">Configurações salvas no navegador.</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div initial={{ opacity: 0, y: 50, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-24 md:bottom-8 right-6 z-[200] bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-4 rounded-2xl shadow-2xl flex items-start gap-3 max-w-[320px]">
            <div className="bg-white/20 dark:bg-black/10 p-2 rounded-full shrink-0"><BellRing size={16} /></div>
            <div className="flex-1 pr-4">
              <h4 className="font-bold text-sm mb-0.5">{toastMsg.title}</h4>
              <p className="text-xs opacity-90">{toastMsg.message}</p>
            </div>
            <button onClick={() => setToastMsg(null)} className="absolute top-4 right-4 opacity-50 hover:opacity-100"><X size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-[#040814]/90 backdrop-blur-xl border-t border-slate-200 dark:border-white/5">
        <div className="flex items-center justify-around p-2">
          <button onClick={() => setActiveTab('dashboard')} className={cn("flex flex-col items-center p-3 rounded-xl transition-colors", activeTab === 'dashboard' ? "text-blue-600 dark:text-blue-400" : "text-slate-500")}>
            <LayoutDashboard size={24} />
          </button>
          <div className="relative -top-6">
            <button onClick={handleNewTaskInit} className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-xl shadow-blue-500/30 active:scale-95 transition-transform border-[6px] border-slate-50 dark:border-[#040814]">
              <Plus size={32} />
            </button>
          </div>
          <button onClick={() => setActiveTab('tasks')} className={cn("flex flex-col items-center p-3 rounded-xl transition-colors relative", activeTab === 'tasks' ? "text-blue-600 dark:text-blue-400" : "text-slate-500")}>
            <ListTodo size={24} />
            {pendingTasks.length > 0 && <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white dark:border-[#040814]" />}
          </button>
        </div>
      </nav>
    </div>
  );
}

// ── Sub-Components ─────────────────────────────────────────────────────────────

function SidebarItem({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={cn(
      "w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all font-medium outline-none group",
      active ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
    )}>
      <div className="flex items-center gap-3">
        <div className={cn(active ? "text-white dark:text-slate-900" : "text-slate-400")}>{icon}</div>
        <span>{label}</span>
      </div>
      {!!badge && badge > 0 && (
        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", active ? "bg-white/20 dark:bg-black/10" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300")}>{badge}</span>
      )}
    </button>
  );
}

function Toggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("w-12 h-6 rounded-full relative transition-colors focus:outline-none border shadow-inner", active ? "bg-blue-500 border-blue-600" : "bg-slate-200 dark:bg-[#040814] border-slate-300 dark:border-white/10")}>
      <motion.div animate={{ x: active ? 24 : 2 }} className="w-5 h-5 rounded-full shadow-sm absolute top-0 bg-white" />
    </button>
  );
}

function FilterTag({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button onClick={onClick} className={cn(
      "flex items-center justify-between w-full px-4 py-2.5 rounded-xl transition-all font-medium text-sm whitespace-nowrap outline-none",
      active ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md" : "bg-slate-100/50 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-white/10"
    )}>
      <span className="flex items-center gap-2">
        {label !== 'Todas' && <Tag size={14} className={active ? "text-white/70 dark:text-slate-900/70" : "text-slate-400"} />}
        {label}
      </span>
      {count !== undefined && <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md", active ? "bg-white/20 dark:bg-black/10" : "bg-slate-200 dark:bg-white/10")}>{count}</span>}
    </button>
  );
}

function MetricCard({ title, value, icon, error }: { title: string; value: number; icon: React.ReactNode; error?: boolean }) {
  return (
    <div className="bg-white dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 rounded-3xl p-5 md:p-6 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4">
        <span className="text-slate-500 font-medium text-sm">{title}</span>
        <div className={cn("p-2 rounded-xl", error ? "bg-rose-50 text-rose-500 dark:bg-rose-500/10" : "bg-slate-50 text-slate-400 dark:bg-white/5")}>{icon}</div>
      </div>
      <div className="text-4xl font-light">{value}</div>
    </div>
  );
}

function TaskItem({ task, onToggle, onDelete, onEdit, compact, isCompletedSection }: {
  task: Task; onToggle: (t: Task) => void; onDelete: (id: string, e: React.MouseEvent) => void;
  onEdit: (t: Task) => void; compact?: boolean; isCompletedSection?: boolean;
}) {
  const safeDate = () => { try { return parseISO(task.dueDate); } catch { return new Date(); } };
  const date = safeDate();
  const isOverdue = isPast(date) && !isToday(date) && task.status !== 'completed';
  const isCompleted = task.status === 'completed';

  const priorityColors: Record<Priority, string> = {
    low: "text-slate-500 bg-slate-100 dark:bg-white/5",
    medium: "text-amber-600 bg-amber-50 dark:bg-amber-500/10",
    high: "text-rose-600 bg-rose-50 dark:bg-rose-500/10",
  };
  const priorityLabels: Record<Priority, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' };

  const formatDate = () => {
    try {
      if (isToday(date)) return 'Hoje';
      if (isTomorrow(date)) return 'Amanhã';
      return format(date, "dd MMM", { locale: ptBR });
    } catch { return '—'; }
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} whileHover={!isCompleted ? { y: -2 } : {}}
      className={cn("group relative flex items-start gap-4 p-4 md:p-5 rounded-2xl transition-all border",
        isCompleted ? "bg-slate-50 dark:bg-white/[0.01] border-transparent" : "bg-white dark:bg-[#0a0f1e] border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 hover:shadow-xl hover:shadow-slate-200/40 dark:hover:shadow-black/40 cursor-pointer"
      )}
      onClick={() => { if (!isCompleted) onEdit(task); }}>
      <button onClick={e => { e.stopPropagation(); onToggle(task); }}
        className={cn("mt-0.5 shrink-0 transition-colors", isCompleted ? "text-emerald-500" : "text-slate-300 hover:text-blue-500 dark:text-slate-600 dark:hover:text-blue-400")}>
        {isCompleted ? <CheckCircle2 size={24} /> : <Circle size={24} />}
      </button>
      <div className="flex-1 min-w-0">
        <h3 className={cn("font-semibold text-base truncate mb-1", isCompleted ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400")}>
          {task.title}
        </h3>
        {!compact && task.description && (
          <p className="text-sm text-slate-500 line-clamp-1 mb-2 pr-8">{task.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-1">
          {!isCompleted && (
            <span className={cn("px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest", priorityColors[task.priority])}>{priorityLabels[task.priority]}</span>
          )}
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md">
            <Tag size={10} />{task.category || 'Geral'}
          </span>
          <span className={cn("flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest", isOverdue ? "text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/10" : "text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5")}>
            <Clock size={10} />{formatDate()}
          </span>
        </div>
      </div>
      <button onClick={e => onDelete(task.id, e)} className="opacity-0 group-hover:opacity-100 p-2 text-slate-400 hover:text-rose-500 bg-slate-50 dark:bg-white/5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition-all absolute right-4 top-4">
        <Trash2 size={16} />
      </button>
    </motion.div>
  );
}
