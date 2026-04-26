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
import { format, isPast, isToday, parseISO } from 'date-fns';
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
import { DashboardPage, type QuickStartTemplate } from './pages/DashboardPage';
import { TasksPage } from './pages/TasksPage';

type AppConfigPatch = Partial<{
  sound: boolean;
  confirmDelete: boolean;
  showCompleted: boolean;
}>;

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const isResetPasswordRoute = pathname === '/reset-password';

  const auth = useAuth();
  const { tasks, createTask, updateTask, deleteTask, toggleStatus } = useTasks(isResetPasswordRoute ? null : auth.token);
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

  const minimumTaskDate = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

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
    const syncPathname = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', syncPathname);
    return () => window.removeEventListener('popstate', syncPathname);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      if (!auth.token) return;
      showToast('SessÃ£o encerrada', 'Sua sessÃ£o expirou. FaÃ§a login novamente.');
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

  const openTaskFromTemplate = useCallback((template: QuickStartTemplate) => {
    resetTaskForm();
    setFormTitle(template.title);
    setFormDesc(template.description);
    setFormDate(template.date);
    setFormTime(template.time ?? '');
    setFormPriority(template.priority);
    setFormCategory(template.category);
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

  const taskDueDateError = useMemo(() => {
    if (!formDate) return '';

    const dueDateValue = new Date(buildDueDateFromForm(formDate, formTime));
    if (isPast(dueDateValue) && !isToday(dueDateValue)) {
      return 'Escolha uma data de hoje em diante.';
    }

    return '';
  }, [formDate, formTime]);

  const handleSubmitTask = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formTitle.trim() || !formDate || isTaskSubmitting) return;

    if (taskDueDateError) {
      notify('Prazo inválido', taskDueDateError);
      return;
    }

    const dueDate = buildDueDateFromForm(formDate, formTime);

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
        notify('Lembrete atualizado!', 'As informaÃ§Ãµes do lembrete foram salvas.');
      } else {
        const created = await createTask(payload);
        notify('Lembrete criado!', `"${created.title}" foi adicionado.`);
      }

      resetTaskForm();
    } catch (err: unknown) {
      notify('Erro', err instanceof Error ? err.message : 'Falha ao salvar o lembrete.');
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
    taskDueDateError,
    updateTask,
  ]);

  const handleToggle = useCallback(async (task: Task) => {
    if (togglingTaskIds.has(task.id)) return;

    try {
      setTogglingTaskIds((prev) => new Set(prev).add(task.id));
      const { newStatus } = await toggleStatus(task);

      if (newStatus === 'completed') {
        playSuccessSound();
        notify('ParabÃ©ns!', `"${task.title}" foi concluÃ­da.`);
      }
    } catch {
      notify('Erro', 'Falha ao atualizar o status do lembrete.');
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
        title: task?.title || 'este lembrete',
      });
      return;
    }

    try {
      setDeletingTaskIds((prev) => new Set(prev).add(id));
      await deleteTask(id);
      showToast('Lembrete removido', 'O lembrete foi excluÃ­do com sucesso.');
    } catch {
      notify('Erro', 'Falha ao excluir o lembrete.');
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
      showToast('Lembrete removido', 'O lembrete foi excluÃ­do com sucesso.');
      setPendingDeleteTask(null);
    } catch {
      notify('Erro', 'Falha ao excluir o lembrete.');
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
      notify('Perfil atualizado!', 'Suas informaÃ§Ãµes foram salvas.');
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

  const navigateTo = useCallback((nextPath: string) => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setPathname(nextPath);
  }, []);

  if (isResetPasswordRoute) {
    return <ResetPage onBackToLogin={() => navigateTo('/')} />;
  }

  if (auth.restoring) {
    return <LoadingScreen />;
  }

  if (!auth.currentUser || !auth.token) {
    return <AuthPage auth={auth} toastNotify={notify} />;
  }

  const greetingName = auth.currentUser.name.split(' ')[0];
  const pageTitle = activeTab === 'dashboard' ? `OlÃ¡, ${greetingName}` : 'Sua agenda';
  const pageDescription = activeTab === 'dashboard'
    ? 'Aqui estÃ¡ uma visÃ£o clara do que pede atenÃ§Ã£o hoje.'
    : 'Organize lembretes, refine prioridades e avance com tranquilidade.';

  return (
    <div className="flex h-screen w-full overflow-hidden text-slate-900 dark:text-slate-100">
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

      <main className="relative flex h-full flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 dark:opacity-20" />

        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/70 bg-white/80 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/75 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_18px_30px_-22px_rgba(37,99,235,0.8)]">
              <Bell size={18} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Painel</p>
              <h1 className="text-lg font-semibold">Lembreto</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openSettings}
              aria-label="Abrir configuraÃ§Ãµes"
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
            >
              <Settings size={20} />
            </button>
            <button
              onClick={openProfile}
              aria-label="Abrir perfil"
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white text-blue-600 transition-all hover:border-blue-300 dark:border-white/10 dark:bg-white/[0.05] dark:text-blue-300"
            >
              {auth.currentUser.avatar ? (
                <img src={auth.currentUser.avatar} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <UserIcon size={16} />
              )}
            </button>
          </div>
        </header>

        <div className="relative mx-auto flex-1 w-full max-w-7xl p-4 pb-28 md:p-8 md:pb-8 xl:p-10">
          <div className="surface-panel mb-8 p-5 md:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <span className="section-eyebrow">
                  {activeTab === 'dashboard' ? 'Painel principal' : 'GestÃ£o de lembretes'}
                </span>
                <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-4xl">
                  {pageTitle}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400 md:text-base">
                  {pageDescription}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                  {pendingTasks.length} pendente{pendingTasks.length === 1 ? '' : 's'}
                </span>
                <span className="rounded-full bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                  {completedTasks.length} concluÃ­da{completedTasks.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          </div>

          <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            {activeTab === 'tasks' && (
              <button
                onClick={openNewTask}
                data-testid="new-task-button"
                className="action-primary hidden md:inline-flex"
              >
                <Plus size={20} /> Novo lembrete
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
                onApplyTemplate={openTaskFromTemplate}
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

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/80 bg-white/92 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/88 md:hidden">
        <div className="flex items-center justify-around p-2">
          <button
            onClick={openDashboardTab}
            aria-label="Abrir dashboard"
            className={cn(
              'flex flex-col items-center rounded-2xl p-3 transition-colors',
              activeTab === 'dashboard' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'text-slate-500'
            )}
          >
            <LayoutDashboard size={24} />
          </button>
          <div className="relative -top-6">
            <button
              onClick={openNewTask}
              aria-label="Criar novo lembrete"
              className="flex h-16 w-16 items-center justify-center rounded-full border-[6px] border-slate-100 bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_24px_40px_-22px_rgba(37,99,235,0.7)] transition-transform active:scale-95 dark:border-slate-950"
            >
              <Plus size={32} />
            </button>
          </div>
          <button
            onClick={openTasksTab}
            aria-label="Abrir lista de lembretes"
            className={cn(
              'relative flex flex-col items-center rounded-2xl p-3 transition-colors',
              activeTab === 'tasks' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'text-slate-500'
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
        dueDateError={taskDueDateError}
        minimumDate={minimumTaskDate}
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
        title="Excluir lembrete?"
        message={
          pendingDeleteTask
            ? `VocÃª estÃ¡ prestes a excluir "${pendingDeleteTask.title}" permanentemente.`
            : ''
        }
        confirmLabel="Excluir lembrete"
        cancelLabel="Manter lembrete"
        isConfirming={pendingDeleteTask ? deletingTaskIds.has(pendingDeleteTask.id) : false}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        onCancel={cancelDelete}
      />
    </div>
  );
}


