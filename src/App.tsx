import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Bell,
  LayoutDashboard,
  ListTodo,
  Plus,
  Settings,
  User as UserIcon,
} from 'lucide-react';
import { isPast, isToday, parseISO } from 'date-fns';
import { AnimatePresence } from 'motion/react';

import { useAuth } from './hooks/useAuth';
import { useTasks } from './hooks/useTasks';
import { useToast } from './hooks/useToast';
import { LS } from './lib/storage';
import { cn } from './lib/cn';
import { AUTH_UNAUTHORIZED_EVENT } from './lib/authEvents';
import { buildDueDateFromForm, parseDueDateToForm } from './lib/taskDueDate';
import { type Priority, type Task } from './types';
import { LoadingScreen } from './components/LoadingScreen';
import { Sidebar } from './components/Sidebar';
import { TaskDrawer } from './components/TaskDrawer';
import { ProfileDrawer } from './components/ProfileDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { Toast } from './components/Toast';
import { ConfirmDialog } from './components/ConfirmDialog';
import { AuthPage } from './pages/AuthPage';
import { ResetPage } from './pages/ResetPage';
import { DashboardPage } from './pages/DashboardPage';
import { TasksPage } from './pages/TasksPage';

type AppConfigPatch = Partial<{
  sound: boolean;
  confirmDelete: boolean;
  showCompleted: boolean;
}>;

export default function App() {
  if (window.location.pathname === '/reset-password') {
    return <ResetPage />;
  }

  const auth = useAuth();
  const { tasks, createTask, updateTask, deleteTask, toggleStatus } = useTasks(auth.token);
  const { toastMsg, setToastMsg, notify, showToast } = useToast();

  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tasks'>('dashboard');
  const [filterCategory, setFilterCategory] = useState('Todas');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  const [showTaskDrawer, setShowTaskDrawer] = useState(false);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [configSound, setConfigSound] = useState(true);
  const [configConfirmDelete, setConfigConfirmDelete] = useState(true);
  const [configShowCompleted, setConfigShowCompleted] = useState(true);

  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [formPriority, setFormPriority] = useState<Priority>('medium');
  const [formCategory, setFormCategory] = useState('Geral');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isTaskSubmitting, setIsTaskSubmitting] = useState(false);
  const [deletingTaskIds, setDeletingTaskIds] = useState<Set<string>>(new Set());
  const [togglingTaskIds, setTogglingTaskIds] = useState<Set<string>>(new Set());
  const [pendingDeleteTask, setPendingDeleteTask] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const [profName, setProfName] = useState('');
  const [profEmail, setProfEmail] = useState('');
  const [profPassword, setProfPassword] = useState('');
  const [profAvatar, setProfAvatar] = useState<string | null>(null);
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);

  useEffect(() => {
    const cfg = LS.getConfig() as Record<string, unknown>;
    if (typeof cfg.sound === 'boolean') setConfigSound(cfg.sound);
    if (typeof cfg.confirmDelete === 'boolean') setConfigConfirmDelete(cfg.confirmDelete);
    if (typeof cfg.showCompleted === 'boolean') setConfigShowCompleted(cfg.showCompleted);
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      setDarkMode(true);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    const onUnauthorized = () => {
      if (!auth.token) return;
      showToast('Sessao encerrada', 'Sua sessao expirou. Entre novamente.');
      void auth.logout();
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
  }, [auth.logout, auth.token, showToast]);

  const saveConfig = useCallback((patch: AppConfigPatch) => {
    const persistedConfig = LS.getConfig();
    const next = {
      ...persistedConfig,
      sound: configSound,
      confirmDelete: configConfirmDelete,
      showCompleted: configShowCompleted,
      ...patch,
    };
    setConfigSound(next.sound);
    setConfigConfirmDelete(next.confirmDelete);
    setConfigShowCompleted(next.showCompleted);
    LS.saveConfig(next);
  }, [configConfirmDelete, configShowCompleted, configSound]);

  const playSuccessSound = useCallback(() => {
    if (!configSound) return;

    try {
      const audioContext = window.AudioContext || (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

      if (!audioContext) return;

      const ctx = new audioContext();
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
      // best effort sound
    }
  }, [configSound]);

  const resetTaskForm = useCallback(() => {
    setFormTitle('');
    setFormDesc('');
    setFormDate('');
    setFormTime('');
    setFormPriority('medium');
    setFormCategory('Geral');
    setEditingTask(null);
    setShowTaskDrawer(false);
  }, []);

  const openNewTask = useCallback(() => {
    resetTaskForm();
    setShowTaskDrawer(true);
  }, [resetTaskForm]);

  const openEditTask = useCallback((task: Task) => {
    const dueDateForm = parseDueDateToForm(task.dueDate);
    setFormTitle(task.title);
    setFormDesc(task.description);
    setFormDate(dueDateForm.date);
    setFormTime(dueDateForm.time);
    setFormPriority(task.priority);
    setFormCategory(task.category || 'Geral');
    setEditingTask(task);
    setShowTaskDrawer(true);
  }, []);

  const handleSubmitTask = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formTitle.trim() || !formDate || isTaskSubmitting) return;

    const dueDate = buildDueDateFromForm(formDate, formTime);
    const dueDateValue = new Date(dueDate);

    if (isPast(dueDateValue) && !isToday(dueDateValue)) {
      notify('Atencao', 'A data estipulada ja passou.');
    }

    const payload = {
      title: formTitle,
      description: formDesc,
      dueDate,
      priority: formPriority,
      category: formCategory,
    };

    try {
      setIsTaskSubmitting(true);

      if (editingTask) {
        await updateTask(editingTask.id, payload);
        notify('Atualizada!', 'Sua tarefa foi modificada.');
      } else {
        const created = await createTask(payload);
        notify('Tarefa criada!', `"${created.title}" foi adicionada.`);
      }

      resetTaskForm();
    } catch (err: unknown) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao salvar tarefa.');
    } finally {
      setIsTaskSubmitting(false);
    }
  }, [
    createTask,
    editingTask,
    formCategory,
    formDate,
    formDesc,
    formPriority,
    formTime,
    formTitle,
    isTaskSubmitting,
    notify,
    resetTaskForm,
    updateTask,
  ]);

  const handleToggle = useCallback(async (task: Task) => {
    if (togglingTaskIds.has(task.id)) return;

    try {
      setTogglingTaskIds((prev) => new Set(prev).add(task.id));
      const { newStatus } = await toggleStatus(task);

      if (newStatus === 'completed') {
        playSuccessSound();
        notify('Parabens!', `"${task.title}" concluida!`);
      }
    } catch {
      notify('Erro', 'Falha ao atualizar status.');
    } finally {
      setTogglingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }, [notify, playSuccessSound, toggleStatus, togglingTaskIds]);

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (deletingTaskIds.has(id)) return;

    if (configConfirmDelete) {
      const task = tasks.find((item) => item.id === id);
      setPendingDeleteTask({
        id,
        title: task?.title || 'esta tarefa',
      });
      return;
    }

    try {
      setDeletingTaskIds((prev) => new Set(prev).add(id));
      await deleteTask(id);
      showToast('Removida', 'A tarefa foi deletada.');
    } catch {
      notify('Erro', 'Falha ao deletar.');
    } finally {
      setDeletingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [configConfirmDelete, deleteTask, deletingTaskIds, notify, showToast, tasks]);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteTask || deletingTaskIds.has(pendingDeleteTask.id)) return;

    const taskToDelete = pendingDeleteTask;

    try {
      setDeletingTaskIds((prev) => new Set(prev).add(taskToDelete.id));
      await deleteTask(taskToDelete.id);
      showToast('Removida', 'A tarefa foi deletada.');
      setPendingDeleteTask(null);
    } catch {
      notify('Erro', 'Falha ao deletar.');
    } finally {
      setDeletingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskToDelete.id);
        return next;
      });
    }
  }, [deleteTask, deletingTaskIds, notify, pendingDeleteTask, showToast]);

  const openProfile = useCallback(() => {
    setProfName(auth.currentUser?.name || '');
    setProfEmail(auth.currentUser?.email || '');
    setProfPassword('');
    setProfAvatar(auth.currentUser?.avatar || null);
    setShowProfileDrawer(true);
  }, [auth.currentUser]);

  const handleUpdateProfile = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProfileSubmitting) return;

    try {
      setIsProfileSubmitting(true);
      await auth.updateProfile({
        name: profName,
        email: profEmail,
        password: profPassword || undefined,
        avatar: profAvatar,
      });
      notify('Perfil atualizado!', 'Suas informacoes foram salvas.');
      setShowProfileDrawer(false);
    } catch (err: unknown) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao atualizar perfil.');
    } finally {
      setIsProfileSubmitting(false);
    }
  }, [auth.updateProfile, isProfileSubmitting, notify, profAvatar, profEmail, profName, profPassword]);

  const normalizedSearch = deferredSearch.trim().toLowerCase();

  const pendingTasks = useMemo(
    () => tasks.filter((task) => task.status === 'pending'),
    [tasks]
  );

  const completedTasks = useMemo(
    () => tasks.filter((task) => task.status === 'completed'),
    [tasks]
  );

  const filteredTasks = useMemo(() => {
    return pendingTasks.filter((task) => {
      const matchesSearch = task.title.toLowerCase().includes(normalizedSearch);
      const matchesCategory = filterCategory === 'Todas' || task.category === filterCategory;
      return matchesSearch && matchesCategory;
    });
  }, [filterCategory, normalizedSearch, pendingTasks]);

  const pendingSummary = useMemo(() => {
    return pendingTasks.reduce(
      (summary, task) => {
        try {
          const dueDate = parseISO(task.dueDate);
          if (isToday(dueDate)) {
            summary.todayCount += 1;
          } else if (isPast(dueDate)) {
            summary.overdueCount += 1;
          }
        } catch {
          // ignore malformed dates in summary
        }

        return summary;
      },
      { todayCount: 0, overdueCount: 0 }
    );
  }, [pendingTasks]);

  const openSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const closeProfileDrawer = useCallback(() => {
    setShowProfileDrawer(false);
  }, []);

  const closeSettingsDrawer = useCallback(() => {
    setShowSettings(false);
  }, []);

  const openTasksTab = useCallback(() => {
    setActiveTab('tasks');
  }, []);

  const openDashboardTab = useCallback(() => {
    setActiveTab('dashboard');
  }, []);

  const dismissToast = useCallback(() => {
    setToastMsg(null);
  }, [setToastMsg]);

  const cancelDelete = useCallback(() => {
    if (!pendingDeleteTask || deletingTaskIds.has(pendingDeleteTask.id)) return;
    setPendingDeleteTask(null);
  }, [deletingTaskIds, pendingDeleteTask]);

  if (auth.restoring) {
    return <LoadingScreen />;
  }

  if (!auth.currentUser || !auth.token) {
    return <AuthPage auth={auth} toastNotify={notify} />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 font-sans text-slate-900 dark:bg-[#02040a] dark:text-slate-100">
      <Sidebar
        currentUser={auth.currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        filterCategory={filterCategory}
        setFilterCategory={setFilterCategory}
        pendingTasks={pendingTasks}
        onOpenProfile={openProfile}
        onOpenSettings={openSettings}
        onLogout={auth.logout}
      />

      <main className="flex h-full flex-1 flex-col overflow-x-hidden overflow-y-auto bg-slate-50 dark:bg-transparent">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/60 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-[#0a0f1e]/80 md:hidden">
          <div className="flex items-center gap-2">
            <Bell size={22} className="text-blue-500" />
            <h1 className="text-lg font-bold">Lembreto</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openSettings}
              className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <Settings size={20} />
            </button>
            <button
              onClick={openProfile}
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-transparent bg-blue-100 text-blue-600 transition-all hover:border-blue-500 dark:bg-blue-900/40"
            >
              {auth.currentUser.avatar ? (
                <img src={auth.currentUser.avatar} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <UserIcon size={16} />
              )}
            </button>
          </div>
        </header>

        <div className="mx-auto flex-1 w-full max-w-7xl p-4 pb-28 md:p-10 md:pb-10">
          <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="mb-1 text-3xl font-bold">
                {activeTab === 'dashboard'
                  ? `Ola, ${auth.currentUser.name.split(' ')[0]}`
                  : 'Suas Atividades'}
              </h2>
              <p className="text-slate-500 dark:text-slate-400">
                {activeTab === 'dashboard'
                  ? 'Aqui esta o panorama do seu dia.'
                  : 'Gerencie e organize suas prioridades.'}
              </p>
            </div>
            {activeTab === 'tasks' && (
              <button
                onClick={openNewTask}
                data-testid="new-task-button"
                className="hidden items-center gap-2 rounded-2xl bg-slate-900 px-6 py-3 font-semibold text-white shadow-xl transition-all hover:opacity-90 active:scale-95 dark:bg-white dark:text-slate-900 md:flex"
              >
                <Plus size={20} /> Nova Tarefa
              </button>
            )}
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <DashboardPage
                tasks={tasks}
                pendingTasks={pendingTasks}
                completedTasks={completedTasks}
                todayCount={pendingSummary.todayCount}
                overdueCount={pendingSummary.overdueCount}
                onViewAll={openTasksTab}
                onNewTask={openNewTask}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onEdit={openEditTask}
                deletingTaskIds={deletingTaskIds}
                togglingTaskIds={togglingTaskIds}
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
                deletingTaskIds={deletingTaskIds}
                togglingTaskIds={togglingTaskIds}
              />
            )}
          </AnimatePresence>
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/90 backdrop-blur-xl dark:border-white/5 dark:bg-[#040814]/90 md:hidden">
        <div className="flex items-center justify-around p-2">
          <button
            onClick={openDashboardTab}
            className={cn(
              'flex flex-col items-center rounded-xl p-3 transition-colors',
              activeTab === 'dashboard' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'
            )}
          >
            <LayoutDashboard size={24} />
          </button>
          <div className="relative -top-6">
            <button
              onClick={openNewTask}
              className="flex h-16 w-16 items-center justify-center rounded-full border-[6px] border-slate-50 bg-blue-600 text-white shadow-xl shadow-blue-500/30 transition-transform active:scale-95 dark:border-[#040814]"
            >
              <Plus size={32} />
            </button>
          </div>
          <button
            onClick={openTasksTab}
            className={cn(
              'relative flex flex-col items-center rounded-xl p-3 transition-colors',
              activeTab === 'tasks' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'
            )}
          >
            <ListTodo size={24} />
            {pendingTasks.length > 0 && (
              <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-500 dark:border-[#040814]" />
            )}
          </button>
        </div>
      </nav>

      <TaskDrawer
        open={showTaskDrawer}
        onClose={resetTaskForm}
        onSubmit={handleSubmitTask}
        editingTask={editingTask}
        darkMode={darkMode}
        isSubmitting={isTaskSubmitting}
        title={formTitle}
        setTitle={setFormTitle}
        description={formDesc}
        setDescription={setFormDesc}
        date={formDate}
        setDate={setFormDate}
        time={formTime}
        setTime={setFormTime}
        priority={formPriority}
        setPriority={setFormPriority}
        category={formCategory}
        setCategory={setFormCategory}
      />

      <ProfileDrawer
        open={showProfileDrawer}
        onClose={closeProfileDrawer}
        onSubmit={handleUpdateProfile}
        onLogout={auth.logout}
        currentUser={auth.currentUser}
        isSubmitting={isProfileSubmitting}
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
        onClose={closeSettingsDrawer}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((value) => !value)}
        sound={configSound}
        onToggleSound={() => saveConfig({ sound: !configSound })}
        confirmDelete={configConfirmDelete}
        onToggleConfirmDelete={() => saveConfig({ confirmDelete: !configConfirmDelete })}
        showCompleted={configShowCompleted}
        onToggleShowCompleted={() => saveConfig({ showCompleted: !configShowCompleted })}
      />

      <Toast toast={toastMsg} onDismiss={dismissToast} />

      <ConfirmDialog
        open={Boolean(pendingDeleteTask)}
        title="Excluir tarefa?"
        message={
          pendingDeleteTask
            ? `Voce esta prestes a excluir "${pendingDeleteTask.title}" permanentemente.`
            : ''
        }
        confirmLabel="Excluir tarefa"
        cancelLabel="Manter tarefa"
        isConfirming={pendingDeleteTask ? deletingTaskIds.has(pendingDeleteTask.id) : false}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        onCancel={cancelDelete}
      />
    </div>
  );
}
