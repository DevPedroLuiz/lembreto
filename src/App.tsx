// src/App.tsx
// Root component — orchestrates auth, navigation and layout.
// Business logic lives in hooks; UI blocks live in components/.

import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  Plus,
  Bell,
  Search,
  LayoutDashboard,
  ListTodo,
  CalendarDays,
  Target,
  Sparkles,
  LogOut,
  Mail,
  Lock,
  User as UserIcon,
  Tag,
  ChevronRight,
  ArrowRight,
  Settings,
} from 'lucide-react';
import { isPast, isToday, parseISO } from 'date-fns';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

// ── Internal imports ──────────────────────────────────────────────────────────
import { useAuth } from './hooks/useAuth';
import { useTasks } from './hooks/useTasks';
import { useToast } from './hooks/useToast';
import { LS } from './lib/storage';
import { CATEGORIES, type Priority, type Task } from './types';
import { TaskDrawer } from './components/TaskDrawer';
import { ProfileDrawer } from './components/ProfileDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { Toast } from './components/Toast';
import { TaskItem } from './components/TaskItem';

// ── Utility ───────────────────────────────────────────────────────────────────
function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

// ── Reset Password Screen (standalone route) ──────────────────────────────────
function ResetPasswordScreen() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    try {
      const { apiPost } = await import('./api/client');
      await apiPost('/api/auth/reset-password', { token, password });
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao redefinir senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-[#040814]">
      <div className="max-w-md w-full bg-white dark:bg-[#0a122a] rounded-3xl p-8 shadow-2xl border border-slate-200 dark:border-white/10">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-4 text-white shadow-lg shadow-blue-500/20">
            <Lock size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Lembreto</h1>
          <p className="text-slate-500 mt-2 text-sm">
            {success ? 'Senha redefinida!' : 'Crie uma nova senha'}
          </p>
        </div>

        {success ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
            <p className="text-slate-600 dark:text-slate-300 text-sm">
              Sua senha foi redefinida com sucesso.
            </p>
            <a
              href="/"
              className="block w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 font-bold transition-all active:scale-95 text-center"
            >
              Ir para o Login
            </a>
          </div>
        ) : !token ? (
          <div className="text-center space-y-4">
            <p className="text-rose-500 font-medium text-sm">Link inválido ou expirado.</p>
            <a
              href="/"
              className="block w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 font-bold text-center"
            >
              Voltar ao Login
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                required
                type="password"
                placeholder="Nova senha (mín. 6 caracteres)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
              />
            </div>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                required
                type="password"
                placeholder="Confirmar nova senha"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
              />
            </div>
            {error && (
              <p className="text-rose-500 text-sm text-center font-medium">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-2xl py-3.5 font-bold transition-all active:scale-95"
            >
              {loading ? 'Salvando...' : 'Redefinir Senha'}
            </button>
            <p className="text-center text-sm">
              <a href="/" className="text-blue-600 font-semibold hover:underline">
                Voltar ao login
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Auth Screen ───────────────────────────────────────────────────────────────
interface AuthScreenProps {
  onSuccess: () => void;
  auth: ReturnType<typeof useAuth>;
  toastNotify: (title: string, msg: string) => void;
}

function AuthScreen({ onSuccess, auth, toastNotify }: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverSuccess, setRecoverSuccess] = useState(false);
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [recoverEmail, setRecoverEmail] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      let user;
      if (isLogin) {
        user = await auth.login(authEmail, authPassword);
      } else {
        user = await auth.register(authName, authEmail, authPassword);
      }
      toastNotify('Bem-vindo!', `Olá, ${user.name}!`);
      onSuccess();
    } catch (err: unknown) {
      setAuthError(
        err instanceof Error ? err.message : 'Falha na comunicação com o servidor.'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      await auth.recoverPassword(recoverEmail);
      setRecoverSuccess(true);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Erro ao recuperar senha.');
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-[#040814]">
      <div className="max-w-md w-full bg-white dark:bg-[#0a122a] rounded-3xl p-8 shadow-2xl border border-slate-200 dark:border-white/10">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-4 text-white shadow-lg shadow-blue-500/20">
            <Target size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Lembreto</h1>
          <p className="text-slate-500 mt-2 text-sm">
            {isRecovering
              ? recoverSuccess
                ? 'E-mail enviado!'
                : 'Recuperar senha'
              : isLogin
              ? 'Faça login para continuar'
              : 'Crie sua conta'}
          </p>
        </div>

        {isRecovering ? (
          recoverSuccess ? (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-500/10 rounded-full flex items-center justify-center">
                  <Mail size={28} className="text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-2">
                  Verifique seu e-mail
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
                  Se{' '}
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {recoverEmail}
                  </span>{' '}
                  estiver cadastrado, você receberá um link em breve.
                </p>
              </div>
              <button
                onClick={() => {
                  setIsRecovering(false);
                  setRecoverSuccess(false);
                  setRecoverEmail('');
                  setAuthError('');
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 font-bold transition-all active:scale-95"
              >
                Voltar ao Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleRecover} className="space-y-4">
              <p className="text-sm text-slate-500 text-center">
                Informe seu email para recuperar sua senha.
              </p>
              <div className="relative">
                <Mail
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  required
                  type="email"
                  placeholder="Seu email"
                  value={recoverEmail}
                  onChange={(e) => setRecoverEmail(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
                />
              </div>
              {authError && (
                <p className="text-rose-500 text-sm text-center font-medium">{authError}</p>
              )}
              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-2xl py-3.5 font-bold transition-all active:scale-95"
              >
                {authLoading ? 'Enviando...' : 'Recuperar Senha'}
              </button>
              <p className="text-center text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setIsRecovering(false);
                    setAuthError('');
                  }}
                  className="text-blue-600 font-semibold hover:underline"
                >
                  Voltar ao login
                </button>
              </p>
            </form>
          )
        ) : (
          <form onSubmit={handleAuth} className="space-y-4">
            {!isLogin && (
              <div className="relative">
                <UserIcon
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  required
                  type="text"
                  placeholder="Seu nome completo"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
                />
              </div>
            )}
            <div className="relative">
              <Mail
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                required
                type="email"
                placeholder="Email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
              />
            </div>
            <div className="relative">
              <Lock
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                required
                type="password"
                placeholder="Senha"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
              />
            </div>
            {isLogin && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => {
                    setIsRecovering(true);
                    setAuthError('');
                  }}
                  className="text-blue-600 text-sm font-semibold hover:underline"
                >
                  Esqueceu a senha?
                </button>
              </div>
            )}
            {authError && (
              <p className="text-rose-500 text-sm text-center font-medium">{authError}</p>
            )}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-2xl py-3.5 font-bold shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
            >
              {authLoading ? 'Aguarde...' : isLogin ? 'Entrar' : 'Criar Conta'}
            </button>
            <p className="text-center text-slate-500 text-sm">
              {isLogin ? 'Não tem uma conta?' : 'Já possui uma conta?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setAuthError('');
                }}
                className="text-blue-600 font-bold hover:underline"
              >
                {isLogin ? 'Registre-se' : 'Faça login'}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Sidebar sub-components ────────────────────────────────────────────────────
function SidebarItem({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all font-medium outline-none group',
        active
          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md'
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(active ? 'text-white dark:text-slate-900' : 'text-slate-400')}>
          {icon}
        </div>
        <span>{label}</span>
      </div>
      {!!badge && badge > 0 && (
        <span
          className={cn(
            'text-[10px] font-bold px-2 py-0.5 rounded-full',
            active
              ? 'bg-white/20 dark:bg-black/10'
              : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300'
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function FilterTag({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center justify-between w-full px-4 py-2.5 rounded-xl transition-all font-medium text-sm whitespace-nowrap outline-none',
        active
          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md'
          : 'bg-slate-100/50 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-white/10'
      )}
    >
      <span className="flex items-center gap-2">
        {label !== 'Todas' && (
          <Tag
            size={14}
            className={active ? 'text-white/70 dark:text-slate-900/70' : 'text-slate-400'}
          />
        )}
        {label}
      </span>
      {count !== undefined && (
        <span
          className={cn(
            'text-[10px] font-bold px-1.5 py-0.5 rounded-md',
            active ? 'bg-white/20 dark:bg-black/10' : 'bg-slate-200 dark:bg-white/10'
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function MetricCard({
  title,
  value,
  icon,
  error,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 rounded-3xl p-5 md:p-6 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4">
        <span className="text-slate-500 font-medium text-sm">{title}</span>
        <div
          className={cn(
            'p-2 rounded-xl',
            error
              ? 'bg-rose-50 text-rose-500 dark:bg-rose-500/10'
              : 'bg-slate-50 text-slate-400 dark:bg-white/5'
          )}
        >
          {icon}
        </div>
      </div>
      <div className="text-4xl font-light">{value}</div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  if (window.location.pathname === '/reset-password') {
    return <ResetPasswordScreen />;
  }

  // ── Hooks ───────────────────────────────────────────────────────────────────
  const auth = useAuth();
  const taskManager = useTasks(auth.token);
  const { toastMsg, setToastMsg, notify, showToast } = useToast();

  // ── UI State ────────────────────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tasks'>('dashboard');
  const [filterCategory, setFilterCategory] = useState('Todas');
  const [search, setSearch] = useState('');

  // Drawers
  const [showTaskDrawer, setShowTaskDrawer] = useState(false);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Settings
  const [configSound, setConfigSound] = useState(true);
  const [configConfirmDelete, setConfigConfirmDelete] = useState(true);
  const [configShowCompleted, setConfigShowCompleted] = useState(true);

  // Task form
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formPriority, setFormPriority] = useState<Priority>('medium');
  const [formCategory, setFormCategory] = useState('Geral');
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Profile form
  const [profName, setProfName] = useState('');
  const [profEmail, setProfEmail] = useState('');
  const [profPassword, setProfPassword] = useState('');
  const [profAvatar, setProfAvatar] = useState<string | null>(null);

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const cfg = LS.getConfig() as Record<string, unknown>;
    if (typeof cfg.sound === 'boolean') setConfigSound(cfg.sound);
    if (typeof cfg.confirmDelete === 'boolean') setConfigConfirmDelete(cfg.confirmDelete);
    if (typeof cfg.showCompleted === 'boolean') setConfigShowCompleted(cfg.showCompleted);
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) setDarkMode(true);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // ── Settings helpers ────────────────────────────────────────────────────────
  const saveConfig = (
    patch: Partial<{ sound: boolean; confirmDelete: boolean; showCompleted: boolean }>
  ) => {
    const next = {
      sound: configSound,
      confirmDelete: configConfirmDelete,
      showCompleted: configShowCompleted,
      ...patch,
    };
    setConfigSound(next.sound);
    setConfigConfirmDelete(next.confirmDelete);
    setConfigShowCompleted(next.showCompleted);
    LS.saveConfig(next);
  };

  // ── Sound ───────────────────────────────────────────────────────────────────
  const playSuccessSound = useCallback(() => {
    if (!configSound) return;
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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
    } catch {
      /* ignore */
    }
  }, [configSound]);

  // ── Task form handlers ──────────────────────────────────────────────────────
  const resetTaskForm = () => {
    setFormTitle('');
    setFormDesc('');
    setFormDate('');
    setFormPriority('medium');
    setFormCategory('Geral');
    setEditingTask(null);
    setShowTaskDrawer(false);
  };

  const openNewTask = () => {
    resetTaskForm();
    setShowTaskDrawer(true);
  };

  const openEditTask = (task: Task) => {
    setFormTitle(task.title);
    setFormDesc(task.description);
    setFormDate(task.dueDate.slice(0, 16));
    setFormPriority(task.priority);
    setFormCategory(task.category || 'Geral');
    setEditingTask(task);
    setShowTaskDrawer(true);
  };

  const handleSubmitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formDate) return;

    if (isPast(new Date(formDate)) && !isToday(new Date(formDate))) {
      notify('Atenção', 'A data estipulada já passou.');
    }

    const payload = {
      title: formTitle,
      description: formDesc,
      dueDate: new Date(formDate).toISOString(),
      priority: formPriority,
      category: formCategory,
    };

    try {
      if (editingTask) {
        await taskManager.updateTask(editingTask.id, payload);
        notify('Atualizada!', 'Sua tarefa foi modificada.');
      } else {
        const created = await taskManager.createTask(payload);
        notify('Tarefa criada!', `"${created.title}" foi adicionada.`);
      }
      resetTaskForm();
    } catch (err: unknown) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao salvar tarefa.');
    }
  };

  // ── Task actions ────────────────────────────────────────────────────────────
  const handleToggle = async (task: Task) => {
    try {
      const { newStatus } = await taskManager.toggleStatus(task);
      if (newStatus === 'completed') {
        playSuccessSound();
        notify('Parabéns!', `"${task.title}" concluída!`);
      }
    } catch {
      notify('Erro', 'Falha ao atualizar status.');
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      configConfirmDelete &&
      !window.confirm('Deseja excluir esta tarefa permanentemente?')
    )
      return;
    try {
      await taskManager.deleteTask(id);
      showToast('Removida', 'A tarefa foi deletada.');
    } catch {
      notify('Erro', 'Falha ao deletar.');
    }
  };

  // ── Profile handlers ────────────────────────────────────────────────────────
  const openProfile = () => {
    setProfName(auth.currentUser?.name || '');
    setProfEmail(auth.currentUser?.email || '');
    setProfPassword('');
    setProfAvatar(auth.currentUser?.avatar || null);
    setShowProfileDrawer(true);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await auth.updateProfile({
        name: profName,
        email: profEmail,
        password: profPassword || undefined,
        avatar: profAvatar,
      });
      notify('Perfil atualizado!', 'Suas informações foram salvas.');
      setShowProfileDrawer(false);
    } catch (err: unknown) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao atualizar perfil.');
    }
  };

  // ── Derived data ────────────────────────────────────────────────────────────
  const { tasks } = taskManager;
  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const filteredTasks = pendingTasks.filter((t) => {
    const matchesSearch = t.title.toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      filterCategory === 'Todas' || t.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const todayCount = pendingTasks.filter((t) => {
    try {
      return isToday(parseISO(t.dueDate));
    } catch {
      return false;
    }
  }).length;

  const overdueCount = pendingTasks.filter((t) => {
    try {
      return isPast(parseISO(t.dueDate)) && !isToday(parseISO(t.dueDate));
    } catch {
      return false;
    }
  }).length;

  // ── Not logged in ───────────────────────────────────────────────────────────
  if (!auth.currentUser || !auth.token) {
    return (
      <AuthScreen
        auth={auth}
        onSuccess={() => {}}
        toastNotify={notify}
      />
    );
  }

  // ── Main layout ─────────────────────────────────────────────────────────────
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
          <SidebarItem
            active={activeTab === 'dashboard'}
            onClick={() => setActiveTab('dashboard')}
            icon={<LayoutDashboard size={20} />}
            label="Dashboard"
          />
          <SidebarItem
            active={activeTab === 'tasks'}
            onClick={() => setActiveTab('tasks')}
            icon={<ListTodo size={20} />}
            label="Minhas Tarefas"
            badge={pendingTasks.length}
          />

          <div className="pt-8 pb-3 px-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Categorias
            </h3>
          </div>
          <FilterTag
            active={filterCategory === 'Todas'}
            onClick={() => {
              setFilterCategory('Todas');
              setActiveTab('tasks');
            }}
            label="Todas"
            count={pendingTasks.length}
          />
          {CATEGORIES.map((cat) => (
            <FilterTag
              key={cat}
              active={filterCategory === cat}
              onClick={() => {
                setFilterCategory(cat);
                setActiveTab('tasks');
              }}
              label={cat}
              count={pendingTasks.filter((t) => t.category === cat).length}
            />
          ))}
        </nav>

        <div className="mt-auto pt-6 space-y-4">
          <div
            onClick={openProfile}
            className="bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 cursor-pointer transition-colors rounded-2xl p-4 flex items-center gap-3"
          >
            {auth.currentUser.avatar ? (
              <img
                src={auth.currentUser.avatar}
                alt="Avatar"
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center shrink-0">
                <UserIcon size={20} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{auth.currentUser.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{auth.currentUser.email}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                auth.logout();
              }}
              className="text-slate-400 hover:text-rose-500 transition-colors shrink-0"
              title="Sair"
            >
              <LogOut size={18} />
            </button>
          </div>

          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-between w-full px-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 transition-colors"
          >
            <span className="text-sm font-medium flex items-center gap-2">
              <Settings size={16} /> Configurações
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto overflow-x-hidden bg-slate-50 dark:bg-transparent">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-slate-200/60 dark:border-white/5 bg-white/70 dark:bg-[#0a0f1e]/80 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <Target size={22} className="text-blue-500" />
            <h1 className="font-bold text-lg">Lembreto</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors"
            >
              <Settings size={20} />
            </button>
            <button
              onClick={openProfile}
              className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center border-2 border-transparent hover:border-blue-500 transition-all overflow-hidden"
            >
              {auth.currentUser.avatar ? (
                <img
                  src={auth.currentUser.avatar}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserIcon size={16} />
              )}
            </button>
          </div>
        </header>

        <div className="flex-1 p-4 md:p-10 max-w-7xl w-full mx-auto pb-28 md:pb-10">
          {/* Page header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
            <div>
              <h2 className="text-3xl font-bold mb-1">
                {activeTab === 'dashboard'
                  ? `Olá, ${auth.currentUser.name.split(' ')[0]}`
                  : 'Suas Atividades'}
              </h2>
              <p className="text-slate-500 dark:text-slate-400">
                {activeTab === 'dashboard'
                  ? 'Aqui está o panorama do seu dia.'
                  : 'Gerencie e organize suas prioridades.'}
              </p>
            </div>
            {activeTab === 'tasks' && (
              <button
                onClick={openNewTask}
                className="hidden md:flex items-center gap-2 bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:opacity-90 px-6 py-3 rounded-2xl font-semibold shadow-xl active:scale-95 transition-all"
              >
                <Plus size={20} /> Nova Tarefa
              </button>
            )}
          </div>

          {/* Tab content */}
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div
                key="dash"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-10"
              >
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                  <MetricCard title="Total" value={tasks.length} icon={<Target size={20} />} />
                  <MetricCard
                    title="Feitas"
                    value={completedTasks.length}
                    icon={<CheckCircle2 size={20} />}
                  />
                  <MetricCard title="Hoje" value={todayCount} icon={<CalendarDays size={20} />} />
                  <MetricCard
                    title="Atrasadas"
                    value={overdueCount}
                    icon={<Bell size={20} />}
                    error
                  />
                </div>

                <div className="grid lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-semibold">Pendentes</h3>
                      <button
                        onClick={() => setActiveTab('tasks')}
                        className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        Ver todas <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="bg-white/50 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 rounded-[2rem] p-4 space-y-3">
                      {pendingTasks.slice(0, 5).map((task) => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          onToggle={handleToggle}
                          onDelete={handleDelete}
                          onEdit={openEditTask}
                          compact
                        />
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
                    <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                      <Sparkles size={100} />
                    </div>
                    <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-widest border border-white/10 w-fit">
                      Progresso
                    </span>
                    <div className="mt-auto z-10">
                      <h3 className="text-5xl font-light mt-8 mb-2">
                        {completedTasks.length}{' '}
                        <span className="text-slate-400 text-2xl">/ {tasks.length}</span>
                      </h3>
                      <p className="text-slate-400 text-sm mb-6">Tarefas completadas.</p>
                      <button
                        onClick={openNewTask}
                        className="w-full bg-white text-slate-900 font-bold py-4 rounded-2xl hover:bg-slate-100 transition-all active:scale-95"
                      >
                        Nova Meta
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'tasks' && (
              <motion.div
                key="tasks"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="flex flex-col md:flex-row gap-4 mb-8">
                  <div className="relative flex-1">
                    <Search
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                      size={20}
                    />
                    <input
                      type="text"
                      placeholder="Buscar tarefas..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="md:hidden flex overflow-x-auto gap-2 pb-1">
                    <FilterTag
                      active={filterCategory === 'Todas'}
                      onClick={() => setFilterCategory('Todas')}
                      label="Todas"
                    />
                    {CATEGORIES.map((cat) => (
                      <FilterTag
                        key={cat}
                        active={filterCategory === cat}
                        onClick={() => setFilterCategory(cat)}
                        label={cat}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <AnimatePresence>
                    {filteredTasks.length > 0 ? (
                      filteredTasks.map((task) => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          onToggle={handleToggle}
                          onDelete={handleDelete}
                          onEdit={openEditTask}
                        />
                      ))
                    ) : (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-20 bg-white/30 dark:bg-white/5 border border-dashed border-slate-200 dark:border-white/10 rounded-3xl"
                      >
                        <Sparkles size={32} className="mx-auto mb-4 text-slate-400" />
                        <h3 className="text-lg font-semibold mb-2">Nada por aqui</h3>
                        <p className="text-slate-500 mb-6">Nenhuma tarefa encontrada.</p>
                        <button
                          onClick={openNewTask}
                          className="px-6 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-semibold active:scale-95 transition-transform"
                        >
                          Criar Tarefa
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {configShowCompleted &&
                  filterCategory === 'Todas' &&
                  !search &&
                  completedTasks.length > 0 && (
                    <div className="mt-12 opacity-60">
                      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-4">
                        Concluídas ({completedTasks.length})
                      </h3>
                      <div className="space-y-3">
                        {completedTasks.map((task) => (
                          <TaskItem
                            key={task.id}
                            task={task}
                            onToggle={handleToggle}
                            onDelete={handleDelete}
                            onEdit={openEditTask}
                            isCompletedSection
                          />
                        ))}
                      </div>
                    </div>
                  )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-[#040814]/90 backdrop-blur-xl border-t border-slate-200 dark:border-white/5">
        <div className="flex items-center justify-around p-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              'flex flex-col items-center p-3 rounded-xl transition-colors',
              activeTab === 'dashboard' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'
            )}
          >
            <LayoutDashboard size={24} />
          </button>
          <div className="relative -top-6">
            <button
              onClick={openNewTask}
              className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-xl shadow-blue-500/30 active:scale-95 transition-transform border-[6px] border-slate-50 dark:border-[#040814]"
            >
              <Plus size={32} />
            </button>
          </div>
          <button
            onClick={() => setActiveTab('tasks')}
            className={cn(
              'flex flex-col items-center p-3 rounded-xl transition-colors relative',
              activeTab === 'tasks' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'
            )}
          >
            <ListTodo size={24} />
            {pendingTasks.length > 0 && (
              <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white dark:border-[#040814]" />
            )}
          </button>
        </div>
      </nav>

      {/* ── Drawers ──────────────────────────────────────────────────────────── */}
      <TaskDrawer
        open={showTaskDrawer}
        onClose={resetTaskForm}
        onSubmit={handleSubmitTask}
        editingTask={editingTask}
        darkMode={darkMode}
        title={formTitle}
        setTitle={setFormTitle}
        description={formDesc}
        setDescription={setFormDesc}
        date={formDate}
        setDate={setFormDate}
        priority={formPriority}
        setPriority={setFormPriority}
        category={formCategory}
        setCategory={setFormCategory}
      />

      <ProfileDrawer
        open={showProfileDrawer}
        onClose={() => setShowProfileDrawer(false)}
        onSubmit={handleUpdateProfile}
        onLogout={auth.logout}
        currentUser={auth.currentUser}
        name={profName}
        setName={setProfName}
        email={profEmail}
        setEmail={setProfEmail}
        password={profPassword}
        setPassword={setProfPassword}
        avatar={profAvatar}
        setAvatar={setProfAvatar}
      />

      <SettingsDrawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        sound={configSound}
        onToggleSound={() => saveConfig({ sound: !configSound })}
        confirmDelete={configConfirmDelete}
        onToggleConfirmDelete={() => saveConfig({ confirmDelete: !configConfirmDelete })}
        showCompleted={configShowCompleted}
        onToggleShowCompleted={() => saveConfig({ showCompleted: !configShowCompleted })}
      />

      {/* Toast */}
      <Toast toast={toastMsg} onDismiss={() => setToastMsg(null)} />
    </div>
  );
}
