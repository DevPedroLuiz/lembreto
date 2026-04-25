// src/App.tsx
// Orquestra autenticação, estado global e layout principal.
// Toda lógica de UI está nos componentes e páginas dedicados.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Bell,
  LayoutDashboard,
  ListTodo,
  User as UserIcon,
  Settings,
} from 'lucide-react';
import { isPast, isToday, parseISO } from 'date-fns';
import { AnimatePresence } from 'motion/react';

// Hooks
import { useAuth } from './hooks/useAuth';
import { useTasks } from './hooks/useTasks';
import { useToast } from './hooks/useToast';

// Lib
import { LS } from './lib/storage';
import { cn } from './lib/cn';

// Types
import { type Priority, type Task } from './types';

// Componentes
import { LoadingScreen } from './components/LoadingScreen';
import { Sidebar } from './components/Sidebar';
import { TaskDrawer } from './components/TaskDrawer';
import { ProfileDrawer } from './components/ProfileDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { Toast } from './components/Toast';

// Páginas
import { AuthPage } from './pages/AuthPage';
import { ResetPage } from './pages/ResetPage';
import { DashboardPage } from './pages/DashboardPage';
import { TasksPage } from './pages/TasksPage';

export default function App() {
  // Rota simples para reset de senha
  if (window.location.pathname === '/reset-password') {
    return <ResetPage />;
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const auth = useAuth();
  const taskManager = useTasks(auth.token);
  const { toastMsg, setToastMsg, notify, showToast } = useToast();

  // ── UI State ──────────────────────────────────────────────────────────────
  const [darkMode, setDarkMode]         = useState(false);
  const [activeTab, setActiveTab]       = useState<'dashboard' | 'tasks'>('dashboard');
  const [filterCategory, setFilterCategory] = useState('Todas');
  const [search, setSearch]             = useState('');

  // Drawers
  const [showTaskDrawer, setShowTaskDrawer]       = useState(false);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [showSettings, setShowSettings]           = useState(false);

  // Configurações
  const [configSound, setConfigSound]                   = useState(true);
  const [configConfirmDelete, setConfigConfirmDelete]   = useState(true);
  const [configShowCompleted, setConfigShowCompleted]   = useState(true);

  // Formulário de tarefa
  const [formTitle, setFormTitle]       = useState('');
  const [formDesc, setFormDesc]         = useState('');
  const [formDate, setFormDate]         = useState('');
  const [formPriority, setFormPriority] = useState<Priority>('medium');
  const [formCategory, setFormCategory] = useState('Geral');
  const [editingTask, setEditingTask]   = useState<Task | null>(null);

  // Formulário de perfil
  const [profName, setProfName]         = useState('');
  const [profEmail, setProfEmail]       = useState('');
  const [profPassword, setProfPassword] = useState('');
  const [profAvatar, setProfAvatar]     = useState<string | null>(null);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const cfg = LS.getConfig() as Record<string, unknown>;
    if (typeof cfg.sound === 'boolean')         setConfigSound(cfg.sound);
    if (typeof cfg.confirmDelete === 'boolean') setConfigConfirmDelete(cfg.confirmDelete);
    if (typeof cfg.showCompleted === 'boolean') setConfigShowCompleted(cfg.showCompleted);
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) setDarkMode(true);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // ── Configurações ─────────────────────────────────────────────────────────
  const saveConfig = (patch: Partial<{ sound: boolean; confirmDelete: boolean; showCompleted: boolean }>) => {
    const next = { sound: configSound, confirmDelete: configConfirmDelete, showCompleted: configShowCompleted, ...patch };
    setConfigSound(next.sound);
    setConfigConfirmDelete(next.confirmDelete);
    setConfigShowCompleted(next.showCompleted);
    LS.saveConfig(next);
  };

  // ── Som ───────────────────────────────────────────────────────────────────
  const playSuccessSound = useCallback(() => {
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
    } catch { /* ignorado */ }
  }, [configSound]);

  // ── Handlers de tarefa ────────────────────────────────────────────────────
  const resetTaskForm = () => {
    setFormTitle(''); setFormDesc(''); setFormDate('');
    setFormPriority('medium'); setFormCategory('Geral');
    setEditingTask(null); setShowTaskDrawer(false);
  };

  const openNewTask = () => { resetTaskForm(); setShowTaskDrawer(true); };

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
    if (isPast(new Date(formDate)) && !isToday(new Date(formDate)))
      notify('Atenção', 'A data estipulada já passou.');

    const payload = {
      title: formTitle, description: formDesc,
      dueDate: new Date(formDate).toISOString(),
      priority: formPriority, category: formCategory,
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

  const handleToggle = async (task: Task) => {
    try {
      const { newStatus } = await taskManager.toggleStatus(task);
      if (newStatus === 'completed') { playSuccessSound(); notify('Parabéns!', `"${task.title}" concluída!`); }
    } catch { notify('Erro', 'Falha ao atualizar status.'); }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (configConfirmDelete && !window.confirm('Deseja excluir esta tarefa permanentemente?')) return;
    try {
      await taskManager.deleteTask(id);
      showToast('Removida', 'A tarefa foi deletada.');
    } catch { notify('Erro', 'Falha ao deletar.'); }
  };

  // ── Handlers de perfil ────────────────────────────────────────────────────
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
      await auth.updateProfile({ name: profName, email: profEmail, password: profPassword || undefined, avatar: profAvatar });
      notify('Perfil atualizado!', 'Suas informações foram salvas.');
      setShowProfileDrawer(false);
    } catch (err: unknown) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao atualizar perfil.');
    }
  };

  // ── Dados derivados ───────────────────────────────────────────────────────
  const { tasks } = taskManager;
  const pendingTasks   = tasks.filter((t) => t.status === 'pending');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const filteredTasks  = pendingTasks.filter((t) => {
    const matchSearch   = t.title.toLowerCase().includes(search.toLowerCase());
    const matchCategory = filterCategory === 'Todas' || t.category === filterCategory;
    return matchSearch && matchCategory;
  });

  const todayCount = pendingTasks.filter((t) => { try { return isToday(parseISO(t.dueDate)); } catch { return false; } }).length;
  const overdueCount = pendingTasks.filter((t) => { try { return isPast(parseISO(t.dueDate)) && !isToday(parseISO(t.dueDate)); } catch { return false; } }).length;

  // ── Guards de rota ────────────────────────────────────────────────────────
  if (auth.restoring) return <LoadingScreen />;

  if (!auth.currentUser || !auth.token) {
    return <AuthPage auth={auth} toastNotify={notify} />;
  }

  // ── Layout principal ──────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-[#02040a] text-slate-900 dark:text-slate-100 overflow-hidden font-sans">

      {/* Sidebar desktop */}
      <Sidebar
        currentUser={auth.currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        filterCategory={filterCategory}
        setFilterCategory={setFilterCategory}
        pendingTasks={pendingTasks}
        onOpenProfile={openProfile}
        onOpenSettings={() => setShowSettings(true)}
        onLogout={auth.logout}
      />

      {/* Conteúdo principal */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto overflow-x-hidden bg-slate-50 dark:bg-transparent">

        {/* Header mobile */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-slate-200/60 dark:border-white/5 bg-white/70 dark:bg-[#0a0f1e]/80 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <Bell size={22} className="text-blue-500" />
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
              {auth.currentUser.avatar
                ? <img src={auth.currentUser.avatar} alt="Avatar" className="w-full h-full object-cover" />
                : <UserIcon size={16} />}
            </button>
          </div>
        </header>

        <div className="flex-1 p-4 md:p-10 max-w-7xl w-full mx-auto pb-28 md:pb-10">
          {/* Cabeçalho da página */}
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

          {/* Conteúdo por aba */}
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <DashboardPage
                tasks={tasks}
                pendingTasks={pendingTasks}
                completedTasks={completedTasks}
                todayCount={todayCount}
                overdueCount={overdueCount}
                onViewAll={() => setActiveTab('tasks')}
                onNewTask={openNewTask}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onEdit={openEditTask}
              />
            )}
            {activeTab === 'tasks' && (
              <TasksPage
                pendingTasks={pendingTasks}
                completedTasks={completedTasks}
                filteredTasks={filteredTasks}
                filterCategory={filterCategory}
                setFilterCategory={setFilterCategory}
                search={search}
                setSearch={setSearch}
                showCompleted={configShowCompleted}
                onNewTask={openNewTask}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onEdit={openEditTask}
              />
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Nav mobile */}
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

      {/* Drawers */}
      <TaskDrawer
        open={showTaskDrawer}
        onClose={resetTaskForm}
        onSubmit={handleSubmitTask}
        editingTask={editingTask}
        darkMode={darkMode}
        title={formTitle}       setTitle={setFormTitle}
        description={formDesc}  setDescription={setFormDesc}
        date={formDate}         setDate={setFormDate}
        priority={formPriority} setPriority={setFormPriority}
        category={formCategory} setCategory={setFormCategory}
      />

      <ProfileDrawer
        open={showProfileDrawer}
        onClose={() => setShowProfileDrawer(false)}
        onSubmit={handleUpdateProfile}
        onLogout={auth.logout}
        currentUser={auth.currentUser}
        name={profName}         setName={setProfName}
        email={profEmail}       setEmail={setProfEmail}
        password={profPassword} setPassword={setProfPassword}
        avatar={profAvatar}     setAvatar={setProfAvatar}
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

      <Toast toast={toastMsg} onDismiss={() => setToastMsg(null)} />
    </div>
  );
}
