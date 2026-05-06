import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BellRing,
  CalendarDays,
  ListTodo,
  NotebookPen,
  Plus,
  Settings,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';
import { addDays, addHours, format, isPast, isToday, isTomorrow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AnimatePresence, motion } from 'motion/react';

import { apiPost } from './api/client';
import { useAuth } from './hooks/useAuth';
import { useHolidays } from './hooks/useHolidays';
import { useNotes } from './hooks/useNotes';
import { useNotifications } from './hooks/useNotifications';
import { usePushNotifications } from './hooks/usePushNotifications';
import { useTasks } from './hooks/useTasks';
import { useToast } from './hooks/useToast';
import { LS, type AppConfig } from './lib/storage';
import { cn } from './lib/cn';
import { AUTH_UNAUTHORIZED_EVENT } from './lib/authEvents';
import {
  buildDueDateFromForm,
  formatDateInputValue,
  getTaskTimeLabel,
  parseDueDateToForm,
} from './lib/taskDueDate';
import {
  buildRecurringDates,
  getRecurrenceSuggestion,
  type RecurrenceMode,
  type RecurrenceSuggestion,
} from './lib/taskRecurrence';
import {
  DEFAULT_CATEGORIES,
  type AppNotification,
  type Note,
  type NoteMode,
  type NotificationTarget,
  type Priority,
  type Task,
} from './types';
import { LoadingScreen } from './components/LoadingScreen';
import { NoteDrawer } from './components/NoteDrawer';
import { Sidebar } from './components/Sidebar';
import { TaskDrawer } from './components/TaskDrawer';
import { TaskDetailsDialog } from './components/TaskDetailsDialog';
import { DashboardMetricDialog } from './components/DashboardMetricDialog';
import { NotificationsInboxDrawer } from './components/NotificationsInboxDrawer';
import { ProfileDrawer } from './components/ProfileDrawer';
import { SettingsDrawer, type SettingsView } from './components/SettingsDrawer';
import { Toast } from './components/Toast';
import { ConfirmDialog } from './components/ConfirmDialog';
import { AuthPage } from './pages/AuthPage';
import { NotesPage } from './pages/NotesPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ResetPage } from './pages/ResetPage';
import { DashboardPage, type QuickStartTemplate } from './pages/DashboardPage';
import { TasksPage } from './pages/TasksPage';
import { CalendarPage } from './pages/CalendarPage';

type AppConfigPatch = Partial<{
  darkMode: boolean;
  notifications: boolean;
  sound: boolean;
  confirmDelete: boolean;
  showCompleted: boolean;
}>;

type DashboardMetricKey = 'completed' | 'today' | 'overdue';
type ViewTab = 'dashboard' | 'calendar' | 'tasks' | 'notes' | 'notifications';

type NotificationTone = 'info' | 'success' | 'warning' | 'error';
type QuickReschedulePreset = 'laterToday' | 'tomorrowMorning' | 'nextWeek';

type EmitNotificationOptions = {
  toastOnly?: boolean;
  skipToast?: boolean;
  target?: NotificationTarget;
  dedupeKey?: string;
  token?: string | null;
};

const UPCOMING_REMINDER_MINUTES = 15;
const OVERDUE_REMINDER_INTERVAL_MINUTES = 30;

function fallbackCopyText(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function buildTaskShareMessage(task: Task): string {
  let dueLabel = 'Data indisponível';

  try {
    dueLabel = format(parseISO(task.dueDate), "dd 'de' MMMM 'de' yyyy", {
      locale: ptBR,
    });
  } catch {
    // keep fallback
  }

  const timeLabel = getTaskTimeLabel(task.dueDate);
  const statusLabel = task.status === 'completed' ? 'Concluído' : 'Pendente';

  return [
    `Lembrete: ${task.title}`,
    task.description?.trim() ? `Detalhes: ${task.description.trim()}` : null,
    `Prazo: ${dueLabel}`,
    `Horário: ${timeLabel || 'Dia todo'}`,
    `Prioridade: ${task.priority === 'high' ? 'Alta' : task.priority === 'medium' ? 'Média' : 'Baixa'}`,
    `Categoria: ${task.category || 'Geral'}`,
    task.tags?.length ? `Tags: ${task.tags.join(', ')}` : null,
    `Status: ${statusLabel}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function roundToNextHalfHour(date: Date): Date {
  const next = new Date(date);
  next.setSeconds(0, 0);

  const remainder = next.getMinutes() % 30;
  const offset = remainder === 0 ? 30 : 30 - remainder;
  next.setMinutes(next.getMinutes() + offset);

  return next;
}

function buildQuickRescheduleDate(task: Task, preset: QuickReschedulePreset): string {
  const dueDateForm = parseDueDateToForm(task.dueDate);

  if (preset === 'tomorrowMorning') {
    const tomorrow = addDays(new Date(), 1);
    return buildDueDateFromForm(formatDateInputValue(tomorrow), '09:00');
  }

  if (preset === 'nextWeek') {
    const nextWeek = addDays(new Date(), 7);
    return buildDueDateFromForm(formatDateInputValue(nextWeek), dueDateForm.time);
  }

  const laterToday = roundToNextHalfHour(addHours(new Date(), 2));

  if (formatDateInputValue(laterToday) !== formatDateInputValue(new Date())) {
    const tomorrow = addDays(new Date(), 1);
    return buildDueDateFromForm(formatDateInputValue(tomorrow), '09:00');
  }

  return buildDueDateFromForm(
    formatDateInputValue(laterToday),
    `${`${laterToday.getHours()}`.padStart(2, '0')}:${`${laterToday.getMinutes()}`.padStart(2, '0')}`,
  );
}

function getMinutesDifference(targetDate: Date, referenceDate: Date) {
  return Math.floor((targetDate.getTime() - referenceDate.getTime()) / 60000);
}

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [locationSearch, setLocationSearch] = useState(() => window.location.search);
  const isResetPasswordRoute = pathname === '/reset-password';

  const auth = useAuth();
  const {
    tasks,
    categories,
    tags,
    createTask,
    updateTask,
    deleteTask,
    toggleStatus,
    createCategory,
    createTag,
    deleteCategory,
    deleteTag,
  } = useTasks(isResetPasswordRoute ? null : auth.token);
  const {
    notes,
    notesByTask,
    createNote,
    updateNote,
    deleteNote,
    refreshNotes,
  } = useNotes(isResetPasswordRoute ? null : auth.token);
  const {
    notifications,
    serverEnabled: serverNotificationsEnabled,
    pushConfigured,
    pushPublicKey,
    loaded: notificationsLoaded,
    refreshNotifications,
    createNotification,
    markNotificationRead,
    markAllRead,
    clearAll,
    updateNotificationsEnabled,
  } = useNotifications(isResetPasswordRoute ? null : auth.token);
  const {
    toastMsg,
    setToastMsg,
    notify: triggerToastNotification,
    showToast: triggerToastOnly,
    notifPerm,
    requestPermission,
  } = useToast();
  const {
    calendar: holidayCalendar,
    isLoading: isHolidayLoading,
    refresh: refreshHolidays,
  } = useHolidays(isResetPasswordRoute ? null : auth.token, isResetPasswordRoute ? null : auth.currentUser);

  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
  const [activeTab, setActiveTab] = useState<ViewTab>('dashboard');
  const [filterCategory, setFilterCategory] = useState('Todas');
  const [search, setSearch] = useState('');

  const [showTaskDrawer, setShowTaskDrawer] = useState(false);
  const [showNoteDrawer, setShowNoteDrawer] = useState(false);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotificationsInbox, setShowNotificationsInbox] = useState(false);
  const [settingsInitialView, setSettingsInitialView] = useState<SettingsView>('appearance');

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [configSound, setConfigSound] = useState(true);
  const [configConfirmDelete, setConfigConfirmDelete] = useState(true);
  const [configShowCompleted, setConfigShowCompleted] = useState(true);

  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [formPriority, setFormPriority] = useState<Priority>('medium');
  const [formCategory, setFormCategory] = useState('Geral');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formSuppressHolidayNotifications, setFormSuppressHolidayNotifications] = useState(false);
  const [formRecurrenceEnabled, setFormRecurrenceEnabled] = useState(false);
  const [formRecurrenceMode, setFormRecurrenceMode] = useState<RecurrenceMode>('daily');
  const [formRecurrenceUntil, setFormRecurrenceUntil] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [noteContextTaskId, setNoteContextTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isTaskSubmitting, setIsTaskSubmitting] = useState(false);
  const [isNoteSubmitting, setIsNoteSubmitting] = useState(false);
  const [showTaskDetails, setShowTaskDetails] = useState(false);
  const [dashboardMetricDialog, setDashboardMetricDialog] = useState<DashboardMetricKey | null>(null);
  const [taskDetailsReturnMetric, setTaskDetailsReturnMetric] = useState<DashboardMetricKey | null>(null);
  const [pendingNotificationTaskId, setPendingNotificationTaskId] = useState<string | null>(null);
  const [deletingTaskIds, setDeletingTaskIds] = useState<Set<string>>(new Set());
  const [togglingTaskIds, setTogglingTaskIds] = useState<Set<string>>(new Set());
  const [reschedulingTaskIds, setReschedulingTaskIds] = useState<Set<string>>(new Set());
  const [pendingDeleteTask, setPendingDeleteTask] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [pendingDeleteTaskSelection, setPendingDeleteTaskSelection] = useState<{
    ids: string[];
    count: number;
  } | null>(null);
  const [pendingDeleteNote, setPendingDeleteNote] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [notificationClock, setNotificationClock] = useState(() => Date.now());

  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [notePriority, setNotePriority] = useState<Priority>('medium');
  const [noteCategory, setNoteCategory] = useState('Geral');
  const [noteTags, setNoteTags] = useState<string[]>([]);
  const [noteMode, setNoteMode] = useState<NoteMode>('temporary');
  const [noteTaskId, setNoteTaskId] = useState<string | null>(null);

  const [profName, setProfName] = useState('');
  const [profEmail, setProfEmail] = useState('');
  const [profPassword, setProfPassword] = useState('');
  const [profAvatar, setProfAvatar] = useState<string | null>(null);
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);
  const [profileSaveSuccess, setProfileSaveSuccess] = useState(false);
  const [isSavingHolidayLocation, setIsSavingHolidayLocation] = useState(false);
  const [isDetectingHolidayLocation, setIsDetectingHolidayLocation] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  );
  const [tabAnimationDirection, setTabAnimationDirection] = useState(1);

  const profileCloseTimerRef = useRef<number | null>(null);
  const previousTabRef = useRef<ViewTab>(activeTab);
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const previewedNotificationIdsRef = useRef<Set<string>>(new Set());
  const welcomedUserIdRef = useRef<string | null>(null);
  const holidayRefreshDayRef = useRef(format(new Date(), 'yyyy-MM-dd'));
  const notificationPreferenceHydratedRef = useRef(false);
  const notificationsOverrideRef = useRef<boolean | null>(null);

  const minimumTaskDate = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const categoryOptions = useMemo(
    () => (categories.length > 0 ? categories : [...DEFAULT_CATEGORIES]),
    [categories],
  );
  const tagOptions = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];

    const append = (value: string) => {
      const normalized = value.trim();
      if (!normalized) return;
      const key = normalized.toLocaleLowerCase('pt-BR');
      if (seen.has(key)) return;
      seen.add(key);
      ordered.push(normalized);
    };

    tags.forEach(append);
    tasks.forEach((task) => task.tags.forEach(append));
    notes.forEach((note) => note.tags.forEach(append));

    return ordered.sort((left, right) =>
      left.localeCompare(right, 'pt-BR', { sensitivity: 'base' }),
    );
  }, [notes, tags, tasks]);
  const noteContextTask = useMemo(
    () => (noteContextTaskId ? tasks.find((task) => task.id === noteContextTaskId) ?? null : null),
    [noteContextTaskId, tasks],
  );

  const refreshNotificationsFromPush = useCallback(() => {
    if (!auth.token) return;
    void refreshNotifications(auth.token).catch(() => {
      // best effort sync after a push arrives
    });
  }, [auth.token, refreshNotifications]);

  const {
    pushSupported,
    subscriptionReady: desktopNotificationsReady,
    isSyncing: isSyncingDesktopNotifications,
    pushError: desktopPushError,
    syncPushSubscription,
  } = usePushNotifications({
    token: isResetPasswordRoute ? null : auth.token,
    enabled: notificationsEnabled,
    pushPublicKey,
    notificationPermission: notifPerm,
    onPushMessage: refreshNotificationsFromPush,
  });

  useEffect(() => {
    const cfg = LS.getConfig();
    if (typeof cfg.darkMode === 'boolean') setDarkMode(cfg.darkMode);
    if (typeof cfg.notifications === 'boolean') setNotificationsEnabled(cfg.notifications);
    if (typeof cfg.sound === 'boolean') setConfigSound(cfg.sound);
    if (typeof cfg.confirmDelete === 'boolean') setConfigConfirmDelete(cfg.confirmDelete);
    if (typeof cfg.showCompleted === 'boolean') setConfigShowCompleted(cfg.showCompleted);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const handleChange = (event: MediaQueryListEvent) => setIsMobileViewport(event.matches);

    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNotificationClock(Date.now());
    }, 60000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!auth.token || !auth.currentUser) return;

    const currentDayKey = format(new Date(notificationClock), 'yyyy-MM-dd');
    if (holidayRefreshDayRef.current === currentDayKey) return;

    holidayRefreshDayRef.current = currentDayKey;
    void refreshHolidays().catch(() => {
      // best effort holiday refresh on day rollover
    });
  }, [auth.currentUser, auth.token, notificationClock, refreshHolidays]);

  useEffect(() => {
    if (!auth.token) return undefined;

    const intervalId = window.setInterval(() => {
      void refreshNotifications().catch(() => {
        // keep local state as-is when polling fails
      });
    }, 60000);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshNotifications().catch(() => {
        // best effort refresh on return
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [auth.token, refreshNotifications]);

  useEffect(() => () => {
    if (profileCloseTimerRef.current) {
      window.clearTimeout(profileCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (serverNotificationsEnabled === null) return;

    if (notificationPreferenceHydratedRef.current) return;

    notificationPreferenceHydratedRef.current = true;
    setNotificationsEnabled(serverNotificationsEnabled);
    LS.saveConfig({
      ...LS.getConfig(),
      notifications: serverNotificationsEnabled,
    });
  }, [serverNotificationsEnabled]);

  useEffect(() => {
    if (!auth.token) {
      seenNotificationIdsRef.current.clear();
      previewedNotificationIdsRef.current.clear();
      welcomedUserIdRef.current = null;
      notificationPreferenceHydratedRef.current = false;
      notificationsOverrideRef.current = null;
      return;
    }

    if (!notificationsLoaded) return;

    if (seenNotificationIdsRef.current.size === 0) {
      notifications.forEach((notification) => {
        seenNotificationIdsRef.current.add(notification.id);
      });
      return;
    }

    notifications.forEach((notification) => {
      if (seenNotificationIdsRef.current.has(notification.id)) return;
      seenNotificationIdsRef.current.add(notification.id);

      if (!notification.read && notificationsEnabled) {
        triggerToastNotification(notification.title, notification.message);
      }
    });
  }, [auth.token, notifications, notificationsEnabled, notificationsLoaded, triggerToastNotification]);

  useEffect(() => {
    if (!auth.token || !auth.currentUser || welcomedUserIdRef.current === auth.currentUser.id) return;

    welcomedUserIdRef.current = auth.currentUser.id;
    void createNotification({
      title: 'Bem-vindo!',
      message: `Ola, ${auth.currentUser.name}!`,
      tone: 'success',
      target: { type: 'notifications' },
      dedupeKey: `user:${auth.currentUser.id}:welcome:${format(new Date(), 'yyyy-MM-dd')}`,
    }).then((result) => {
      if (!result.created) return;
      seenNotificationIdsRef.current.add(result.notification.id);
      triggerToastNotification('Bem-vindo!', `Ola, ${auth.currentUser.name}!`);
    }).catch(() => {
      triggerToastNotification('Bem-vindo!', `Ola, ${auth.currentUser.name}!`);
    });
  }, [auth.currentUser, auth.token, createNotification, triggerToastNotification]);

  useEffect(() => {
    const unreadCount = notifications.reduce((count, notification) => (
      notification.read ? count : count + 1
    ), 0);

    if (activeTab !== 'notifications' || unreadCount === 0 || !auth.token) return;

    void markAllRead().catch(() => {
      // best effort sync for central open
    });
  }, [activeTab, auth.token, markAllRead, notifications]);

  useEffect(() => {
    const syncLocation = () => {
      setPathname(window.location.pathname);
      setLocationSearch(window.location.search);
    };
    window.addEventListener('popstate', syncLocation);
    return () => window.removeEventListener('popstate', syncLocation);
  }, []);

  useEffect(() => {
    const tabOrder: Record<ViewTab, number> = {
      dashboard: 0,
      calendar: 1,
      tasks: 2,
      notes: 3,
      notifications: 4,
    };

    const previousTab = previousTabRef.current;
    if (previousTab !== activeTab) {
      setTabAnimationDirection(tabOrder[activeTab] >= tabOrder[previousTab] ? 1 : -1);
      previousTabRef.current = activeTab;
    }
  }, [activeTab]);

  useEffect(() => {
    const onUnauthorized = () => {
      if (!auth.token) return;

      triggerToastOnly('Sessão encerrada', 'Sua sessão expirou. Faça login novamente.');
      void auth.logout();
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
  }, [auth.logout, auth.token, triggerToastOnly]);

  const saveConfig = useCallback((patch: AppConfigPatch) => {
    const persistedConfig = LS.getConfig();
    const next: AppConfig = {
      ...persistedConfig,
      darkMode,
      notifications: notificationsEnabled,
      sound: configSound,
      confirmDelete: configConfirmDelete,
      showCompleted: configShowCompleted,
      ...patch,
    };
    if (typeof next.darkMode === 'boolean') setDarkMode(next.darkMode);
    setNotificationsEnabled(Boolean(next.notifications));
    setConfigSound(Boolean(next.sound));
    setConfigConfirmDelete(Boolean(next.confirmDelete));
    setConfigShowCompleted(Boolean(next.showCompleted));
    LS.saveConfig(next);
  }, [configConfirmDelete, configShowCompleted, configSound, darkMode, notificationsEnabled]);

  const toggleDarkMode = useCallback(() => {
    saveConfig({ darkMode: !darkMode });
  }, [darkMode, saveConfig]);

  const handleDeleteCategory = useCallback(async (name: string) => {
    await deleteCategory(name);
    await refreshNotes();
  }, [deleteCategory, refreshNotes]);

  const handleDeleteTag = useCallback(async (name: string) => {
    await deleteTag(name);
    await refreshNotes();
  }, [deleteTag, refreshNotes]);

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

  const emitNotification = useCallback((
    title: string,
    message: string,
    tone: NotificationTone = 'info',
    options?: EmitNotificationOptions
  ) => {
    const notificationsAllowed = notificationsOverrideRef.current ?? notificationsEnabled;
    if (!notificationsAllowed) return;

    const notificationToken = options?.token ?? auth.token;

    if (!notificationToken) {
      if (!options?.skipToast) {
        if (options?.toastOnly) {
          triggerToastOnly(title, message);
        } else {
          triggerToastNotification(title, message);
        }
      }
      return;
    }

    void createNotification({
      title,
      message,
      tone,
      token: notificationToken,
      target: options?.target,
      dedupeKey: options?.dedupeKey,
    }).then((result) => {
      if (!result.created || options?.skipToast) return;

      seenNotificationIdsRef.current.add(result.notification.id);

      if (options?.toastOnly) {
        triggerToastOnly(title, message);
      } else {
        triggerToastNotification(title, message);
      }
    }).catch(() => {
      if (!options?.skipToast) {
        if (options?.toastOnly) {
          triggerToastOnly(title, message);
        } else {
          triggerToastNotification(title, message);
        }
      }
    });
  }, [auth.token, createNotification, notificationsEnabled, triggerToastNotification, triggerToastOnly]);

  const resetTaskForm = useCallback(() => {
    setFormTitle('');
    setFormDesc('');
    setFormDate('');
    setFormTime('');
    setFormPriority('medium');
    setFormCategory('Geral');
    setFormTags([]);
    setFormSuppressHolidayNotifications(false);
    setFormRecurrenceEnabled(false);
    setFormRecurrenceMode('daily');
    setFormRecurrenceUntil('');
    setEditingTask(null);
    setShowTaskDrawer(false);
  }, []);

  const resetNoteForm = useCallback(() => {
    setNoteTitle('');
    setNoteContent('');
    setNotePriority('medium');
    setNoteCategory('Geral');
    setNoteTags([]);
    setNoteMode('temporary');
    setNoteTaskId(null);
    setNoteContextTaskId(null);
    setEditingNote(null);
    setShowNoteDrawer(false);
  }, []);

  useEffect(() => {
    if (!selectedTask) return;

    const updatedTask = tasks.find((task) => task.id === selectedTask.id);
    if (!updatedTask) {
      setSelectedTask(null);
      setShowTaskDetails(false);
      return;
    }

    if (updatedTask !== selectedTask) {
      setSelectedTask(updatedTask);
    }
  }, [selectedTask, tasks]);

  useEffect(() => {
    if (!pendingNotificationTaskId) return;

    const relatedTask = tasks.find((task) => task.id === pendingNotificationTaskId);
    if (!relatedTask) return;

    setDashboardMetricDialog(null);
    setTaskDetailsReturnMetric(null);
    setSelectedTask(relatedTask);
    setShowTaskDetails(true);
    setPendingNotificationTaskId(null);
  }, [pendingNotificationTaskId, tasks]);

  const openNewTask = useCallback(() => {
    resetTaskForm();
    setShowNotificationsInbox(false);
    setSelectedTask(null);
    setShowTaskDetails(false);
    setTaskDetailsReturnMetric(null);
    setShowTaskDrawer(true);
  }, [resetTaskForm]);

  const openNewNote = useCallback((task?: Task | null) => {
    resetNoteForm();
    setShowNotificationsInbox(false);
    if (task) {
      setNoteCategory(task.category || 'Geral');
      setNotePriority(task.priority);
      setNoteTaskId(task.id);
      setNoteContextTaskId(task.id);
    }
    setShowNoteDrawer(true);
  }, [resetNoteForm]);

  const openTaskFromTemplate = useCallback((template: QuickStartTemplate) => {
    resetTaskForm();
    setShowNotificationsInbox(false);
    setFormTitle(template.title);
    setFormDesc(template.description);
    setFormDate(template.date);
    setFormTime(template.time ?? '');
    setFormPriority(template.priority);
    setFormCategory(template.category);
    setFormTags([]);
    setFormSuppressHolidayNotifications(false);
    setShowTaskDrawer(true);
  }, [resetTaskForm]);

  const openEditTask = useCallback((task: Task) => {
    setShowNotificationsInbox(false);
    const dueDateForm = parseDueDateToForm(task.dueDate);
    setFormTitle(task.title);
    setFormDesc(task.description);
    setFormDate(dueDateForm.date);
    setFormTime(dueDateForm.time);
    setFormPriority(task.priority);
    setFormCategory(task.category || 'Geral');
    setFormTags(task.tags ?? []);
    setFormSuppressHolidayNotifications(task.suppressHolidayNotifications ?? false);
    setFormRecurrenceEnabled(false);
    setFormRecurrenceMode('daily');
    setFormRecurrenceUntil('');
    setEditingTask(task);
    setSelectedTask(task);
    setShowTaskDetails(false);
    setTaskDetailsReturnMetric(null);
    setShowTaskDrawer(true);
  }, []);

  const openDuplicateTask = useCallback((task: Task) => {
    setShowNotificationsInbox(false);
    const dueDateForm = parseDueDateToForm(task.dueDate);
    setFormTitle(`${task.title} (cópia)`);
    setFormDesc(task.description);
    setFormDate(dueDateForm.date);
    setFormTime(dueDateForm.time);
    setFormPriority(task.priority);
    setFormCategory(task.category || 'Geral');
    setFormTags(task.tags ?? []);
    setFormSuppressHolidayNotifications(task.suppressHolidayNotifications ?? false);
    setFormRecurrenceEnabled(false);
    setFormRecurrenceMode('daily');
    setFormRecurrenceUntil('');
    setEditingTask(null);
    setSelectedTask(null);
    setShowTaskDetails(false);
    setTaskDetailsReturnMetric(null);
    setShowTaskDrawer(true);
  }, []);

  const openTaskDetails = useCallback((task: Task) => {
    setShowNotificationsInbox(false);
    setDashboardMetricDialog(null);
    setTaskDetailsReturnMetric(null);
    setSelectedTask(task);
    setShowTaskDetails(true);
  }, []);

  const openEditNote = useCallback((note: Note, options?: { taskContextId?: string | null }) => {
    setShowNotificationsInbox(false);
    setEditingNote(note);
    setNoteTitle(note.title);
    setNoteContent(note.content);
    setNotePriority(note.priority);
    setNoteCategory(note.category || 'Geral');
    setNoteTags(note.tags ?? []);
    setNoteMode(note.mode);
    setNoteTaskId(note.taskId ?? null);
    setNoteContextTaskId(options?.taskContextId ?? null);
    setShowNoteDrawer(true);
  }, []);

  const openTaskDetailsFromMetric = useCallback((task: Task, metric: DashboardMetricKey) => {
    setShowNotificationsInbox(false);
    setDashboardMetricDialog(null);
    setTaskDetailsReturnMetric(metric);
    setSelectedTask(task);
    setShowTaskDetails(true);
  }, []);

  const closeTaskDetails = useCallback(() => {
    setShowTaskDetails(false);
    setSelectedTask(null);
    setTaskDetailsReturnMetric(null);
    setPendingNotificationTaskId(null);
  }, []);

  const openDashboardMetric = useCallback((metric: DashboardMetricKey) => {
    setDashboardMetricDialog(metric);
  }, []);

  const closeDashboardMetric = useCallback(() => {
    setDashboardMetricDialog(null);
  }, []);

  const returnToDashboardMetric = useCallback(() => {
    if (!taskDetailsReturnMetric) return;
    setShowTaskDetails(false);
    setDashboardMetricDialog(taskDetailsReturnMetric);
    setTaskDetailsReturnMetric(null);
  }, [taskDetailsReturnMetric]);

  const handleShareTask = useCallback(async (task: Task) => {
    const shareMessage = buildTaskShareMessage(task);

    try {
      if ('share' in navigator && typeof navigator.share === 'function') {
        await navigator.share({
          title: task.title,
          text: shareMessage,
        });
        emitNotification('Lembrete compartilhado', 'O conteúdo foi enviado pelo compartilhamento do dispositivo.', 'success');
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareMessage);
      } else {
        fallbackCopyText(shareMessage);
      }

      emitNotification('Resumo copiado', 'O lembrete foi copiado para você compartilhar onde quiser.', 'info');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      emitNotification('Não foi possível compartilhar', 'Tente novamente em outro navegador ou aplicativo.', 'error');
    }
  }, [emitNotification]);

  const handleQuickReschedule = useCallback(async (task: Task, preset: QuickReschedulePreset) => {
    if (reschedulingTaskIds.has(task.id)) return;

    const presetLabel = preset === 'laterToday'
      ? 'para mais tarde hoje'
      : preset === 'tomorrowMorning'
        ? 'para amanhã cedo'
        : 'para a próxima semana';

    try {
      setReschedulingTaskIds((prev) => new Set(prev).add(task.id));
      const updated = await updateTask(task.id, {
        dueDate: buildQuickRescheduleDate(task, preset),
        status: 'pending',
      });

      setSelectedTask(updated);
      emitNotification(
        'Lembrete reagendado',
        `"${task.title}" foi ajustado ${presetLabel}.`,
        'success',
        {
          target: { type: 'task', taskId: task.id },
        },
      );
    } catch (error) {
      emitNotification(
        'Não foi possível reagendar',
        error instanceof Error ? error.message : 'Tente novamente em instantes.',
        'error',
      );
    } finally {
      setReschedulingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }, [emitNotification, reschedulingTaskIds, updateTask]);

  const taskDueDateError = useMemo(() => {
    if (!formDate) return '';

    const dueDateValue = new Date(buildDueDateFromForm(formDate, formTime));
    if (isPast(dueDateValue) && !isToday(dueDateValue)) {
      return 'Escolha uma data de hoje em diante.';
    }

    return '';
  }, [formDate, formTime]);

  const recurringDates = useMemo(() => {
    if (!formRecurrenceEnabled || !formDate || !formRecurrenceUntil) return [];
    return buildRecurringDates(formDate, formRecurrenceUntil, formRecurrenceMode);
  }, [formDate, formRecurrenceEnabled, formRecurrenceMode, formRecurrenceUntil]);

  const holidayDateKeys = useMemo(() => {
    const keys = new Set<string>();
    const allEntries = holidayCalendar?.allEntries ?? [];

    allEntries.forEach((entry) => {
      try {
        keys.add(format(parseISO(entry.date), 'yyyy-MM-dd'));
      } catch {
        if (entry.date) keys.add(entry.date.slice(0, 10));
      }
    });

    return keys;
  }, [holidayCalendar]);

  const recurringHolidaySuppressedCount = useMemo(() => {
    if (!formRecurrenceEnabled || !formSuppressHolidayNotifications || recurringDates.length === 0) return 0;

    return recurringDates.reduce((count, dateValue) => (
      holidayDateKeys.has(dateValue) ? count + 1 : count
    ), 0);
  }, [formRecurrenceEnabled, formSuppressHolidayNotifications, holidayDateKeys, recurringDates]);

  const recurrenceError = useMemo(() => {
    if (editingTask || !formRecurrenceEnabled) return '';
    if (!formDate) return '';
    if (!formRecurrenceUntil) return 'Defina a data final da repetição.';
    if (formRecurrenceUntil < formDate) return 'A repetição precisa terminar na mesma data ou depois do início.';
    if (recurringDates.length === 0) return 'Nenhuma data do intervalo corresponde a esse padrão de repetição.';
    if (recurringDates.length > 120) return 'Reduza o intervalo para no máximo 120 lembretes por criação.';
    return '';
  }, [editingTask, formDate, formRecurrenceEnabled, formRecurrenceUntil, recurringDates.length]);

  const applyRecurrenceSuggestion = useCallback((suggestion: RecurrenceSuggestion) => {
    const nextSuggestion = getRecurrenceSuggestion(formDate, suggestion);
    if (!nextSuggestion) {
      emitNotification('Escolha a data inicial primeiro', 'Defina o primeiro dia do lembrete antes de aplicar uma sugestão.', 'warning');
      return;
    }

    setFormRecurrenceEnabled(true);
    setFormRecurrenceMode(nextSuggestion.mode);
    setFormRecurrenceUntil(nextSuggestion.until);
  }, [emitNotification, formDate]);

  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications],
  );

  const markAllNotificationsRead = useCallback(() => {
    void markAllRead().catch(() => {
      triggerToastOnly('Não foi possível atualizar', 'Tente marcar as notificações como lidas novamente.');
    });
  }, [markAllRead, triggerToastOnly]);

  const clearNotifications = useCallback(() => {
    void clearAll().catch(() => {
      triggerToastOnly('Não foi possível limpar', 'Tente limpar o histórico novamente.');
    });
  }, [clearAll, triggerToastOnly]);

  const handleToggleNotifications = useCallback(async () => {
    const nextValue = !notificationsEnabled;
    notificationsOverrideRef.current = nextValue;
    saveConfig({ notifications: nextValue });

    try {
      await updateNotificationsEnabled(nextValue);

      if (nextValue) {
        await requestPermission();
        triggerToastOnly('Notificações ativadas', 'Novos avisos voltarão a aparecer na central e na interface.');
      } else {
        triggerToastOnly('Notificações desativadas', 'A central deixará de registrar novos avisos até você reativar.');
      }
    } catch {
      notificationsOverrideRef.current = !nextValue;
      saveConfig({ notifications: !nextValue });
      triggerToastOnly('Não foi possível salvar', 'A preferência de notificações não foi atualizada.');
    }
  }, [notificationsEnabled, requestPermission, saveConfig, triggerToastOnly, updateNotificationsEnabled]);

  const handleEnableDesktopNotifications = useCallback(async () => {
    if (!auth.token) {
      triggerToastOnly('Faça login primeiro', 'Entre na sua conta para conectar este navegador às notificações do Windows.');
      return;
    }

    if (!pushConfigured || !pushPublicKey) {
      triggerToastOnly('Push indisponível', 'As chaves de notificação ainda não foram configuradas neste ambiente.');
      return;
    }

    let enabledNotifications = notificationsEnabled;

    try {
      if (!enabledNotifications) {
        notificationsOverrideRef.current = true;
        saveConfig({ notifications: true });
        setNotificationsEnabled(true);
        await updateNotificationsEnabled(true);
        enabledNotifications = true;
      }

      const permission = await requestPermission();
      if (permission !== 'granted') {
        triggerToastOnly(
          'Permissão necessária',
          permission === 'denied'
            ? 'O navegador bloqueou as notificações. Libere a permissão nas configurações do site.'
            : 'Permita notificações no navegador para receber avisos do Windows.',
        );
        return;
      }

      await syncPushSubscription();
      triggerToastOnly(
        'Notificações do Windows ativadas',
        'Este navegador foi conectado e passará a receber seus lembretes fora da aba.',
      );
    } catch (error) {
      if (!enabledNotifications) {
        notificationsOverrideRef.current = false;
        saveConfig({ notifications: false });
        setNotificationsEnabled(false);
      }

      triggerToastOnly(
        'Não foi possível ativar',
        error instanceof Error
          ? error.message
          : 'Não foi possível ativar as notificações do Windows neste navegador.',
      );
    }
  }, [
    auth.token,
    notificationsEnabled,
    pushConfigured,
    pushPublicKey,
    requestPermission,
    saveConfig,
    syncPushSubscription,
    triggerToastOnly,
    updateNotificationsEnabled,
  ]);

  const handleSubmitTask = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formTitle.trim() || !formDate || isTaskSubmitting) return;

    if (taskDueDateError) {
      emitNotification('Prazo inválido', taskDueDateError, 'warning');
      return;
    }

    if (recurrenceError) {
      emitNotification('Repetição inválida', recurrenceError, 'warning');
      return;
    }

    const dueDate = buildDueDateFromForm(formDate, formTime);

    const payload = {
      title: formTitle,
      description: formDesc,
      dueDate,
      priority: formPriority,
      category: formCategory,
      tags: formTags,
      suppressHolidayNotifications: formSuppressHolidayNotifications,
    };

      try {
        setIsTaskSubmitting(true);

        if (editingTask) {
          await updateTask(editingTask.id, payload);
          emitNotification('Lembrete atualizado!', 'As informações do lembrete foram salvas.', 'success', {
            target: { type: 'task', taskId: editingTask.id },
          });
        } else {
          if (formRecurrenceEnabled && recurringDates.length > 1) {
            for (const dateValue of recurringDates) {
              await createTask({
                ...payload,
                dueDate: buildDueDateFromForm(dateValue, formTime),
              });
            }

            emitNotification(
              'Lembretes criados!',
              `${recurringDates.length} lembretes foram adicionados até ${formRecurrenceUntil}.`,
              'success',
            );
          } else {
            const created = await createTask(payload);
            emitNotification('Lembrete criado!', `"${created.title}" foi adicionado.`, 'success', {
              target: { type: 'task', taskId: created.id },
            });
          }
        }

      resetTaskForm();
    } catch (err: unknown) {
      emitNotification('Erro', err instanceof Error ? err.message : 'Falha ao salvar o lembrete.', 'error');
    } finally {
      setIsTaskSubmitting(false);
    }
  }, [
    createTask,
    emitNotification,
    editingTask,
    formCategory,
    formDate,
    formDesc,
    formPriority,
    formTime,
    formTitle,
    formTags,
      formSuppressHolidayNotifications,
      isTaskSubmitting,
      resetTaskForm,
      recurringDates,
      recurrenceError,
      formRecurrenceEnabled,
      formRecurrenceUntil,
      taskDueDateError,
      updateTask,
    ]);

  const handleSubmitNote = useCallback(async () => {
    if (!noteTitle.trim() || isNoteSubmitting) return;

    const payload = {
      title: noteTitle,
      content: noteContent,
      priority: notePriority,
      category: noteCategory,
      tags: noteTags,
      mode: noteMode,
      taskId: noteContextTaskId ?? noteTaskId,
    };

    try {
      setIsNoteSubmitting(true);

      if (editingNote) {
        await updateNote(editingNote.id, payload);
        emitNotification('Nota atualizada', 'As informações da nota foram salvas.', 'success', {
          target: payload.taskId ? { type: 'task', taskId: payload.taskId } : { type: 'notifications' },
        });
      } else {
        await createNote(payload);
        emitNotification('Nota criada', 'A nota foi adicionada ao seu caderno.', 'success', {
          target: payload.taskId ? { type: 'task', taskId: payload.taskId } : { type: 'notifications' },
        });
      }

      resetNoteForm();
    } catch (error) {
      emitNotification('Erro', error instanceof Error ? error.message : 'Falha ao salvar a nota.', 'error');
    } finally {
      setIsNoteSubmitting(false);
    }
  }, [
    createNote,
    editingNote,
    emitNotification,
    isNoteSubmitting,
    noteCategory,
    noteContent,
    noteContextTaskId,
    noteMode,
    notePriority,
    noteTags,
    noteTaskId,
    noteTitle,
    resetNoteForm,
    updateNote,
  ]);

  const handleToggle = useCallback(async (task: Task) => {
    if (togglingTaskIds.has(task.id)) return;

    try {
      setTogglingTaskIds((prev) => new Set(prev).add(task.id));
      const { task: updatedTask, newStatus } = await toggleStatus(task);

      if (newStatus === 'completed') {
        playSuccessSound();
        emitNotification('Parabéns!', `"${task.title}" foi concluído.`, 'success', {
          target: { type: 'task', taskId: task.id },
        });
      }

      return { task: updatedTask, newStatus };
    } catch {
      emitNotification('Erro', 'Falha ao atualizar o status do lembrete.', 'error');
      return null;
    } finally {
      setTogglingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }, [emitNotification, playSuccessSound, toggleStatus, togglingTaskIds]);

  const handleToggleFromDetails = useCallback(async (task: Task) => {
    const result = await handleToggle(task);
    if (result?.newStatus === 'completed') {
      setShowTaskDetails(false);
      setSelectedTask(null);
      return;
    }

    if (result?.task) {
      setSelectedTask(result.task);
    }
  }, [handleToggle]);

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
      emitNotification('Lembrete removido', 'O lembrete foi excluído com sucesso.', 'info', { toastOnly: true });
      if (selectedTask?.id === id) {
        setSelectedTask(null);
        setShowTaskDetails(false);
      }
    } catch {
      emitNotification('Erro', 'Falha ao excluir o lembrete.', 'error');
    } finally {
      setDeletingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [configConfirmDelete, deleteTask, deletingTaskIds, emitNotification, selectedTask?.id, tasks]);

  const handleDeleteSelectedTasks = useCallback(async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (uniqueIds.length === 0) return;

    if (configConfirmDelete) {
      setPendingDeleteTaskSelection({
        ids: uniqueIds,
        count: uniqueIds.length,
      });
      return;
    }

    try {
      setDeletingTaskIds((prev) => {
        const next = new Set(prev);
        uniqueIds.forEach((id) => next.add(id));
        return next;
      });

      let deletedCount = 0;
      for (const id of uniqueIds) {
        try {
          await deleteTask(id);
          deletedCount += 1;
        } catch {
          // continue deleting what is still possible
        }
      }

      if (selectedTask && uniqueIds.includes(selectedTask.id)) {
        setSelectedTask(null);
        setShowTaskDetails(false);
      }

      if (deletedCount === uniqueIds.length) {
        emitNotification(
          'Lembretes removidos',
          `${deletedCount} lembrete${deletedCount === 1 ? '' : 's'} foram excluídos com sucesso.`,
          'info',
          { toastOnly: true },
        );
      } else if (deletedCount > 0) {
        emitNotification(
          'Exclusão parcial',
          `${deletedCount} de ${uniqueIds.length} lembretes foram excluídos.`,
          'warning',
        );
      } else {
        emitNotification('Erro', 'Falha ao excluir os lembretes selecionados.', 'error');
      }
    } finally {
      setDeletingTaskIds((prev) => {
        const next = new Set(prev);
        uniqueIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  }, [configConfirmDelete, deleteTask, emitNotification, selectedTask]);

  const handleDeleteFromDetails = useCallback((task: Task) => {
    if (deletingTaskIds.has(task.id)) return;

    setSelectedTask(task);
    if (configConfirmDelete) {
      setPendingDeleteTask({
        id: task.id,
        title: task.title,
      });
      return;
    }

    try {
      setDeletingTaskIds((prev) => new Set(prev).add(task.id));
      void deleteTask(task.id).then(() => {
        emitNotification('Lembrete removido', 'O lembrete foi excluído com sucesso.', 'info', { toastOnly: true });
        setSelectedTask(null);
        setShowTaskDetails(false);
      }).catch(() => {
        emitNotification('Erro', 'Falha ao excluir o lembrete.', 'error');
      }).finally(() => {
        setDeletingTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      });
    } catch {
      emitNotification('Erro', 'Falha ao excluir o lembrete.', 'error');
    }
  }, [configConfirmDelete, deleteTask, deletingTaskIds, emitNotification]);

  const handleDeleteNote = useCallback((note: Note) => {
    setPendingDeleteNote({
      id: note.id,
      title: note.title,
    });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteTask || deletingTaskIds.has(pendingDeleteTask.id)) return;

    const taskToDelete = pendingDeleteTask;

    try {
      setDeletingTaskIds((prev) => new Set(prev).add(taskToDelete.id));
      await deleteTask(taskToDelete.id);
      emitNotification('Lembrete removido', 'O lembrete foi excluído com sucesso.', 'info', { toastOnly: true });
      if (selectedTask?.id === taskToDelete.id) {
        setSelectedTask(null);
        setShowTaskDetails(false);
      }
      setPendingDeleteTask(null);
    } catch {
      emitNotification('Erro', 'Falha ao excluir o lembrete.', 'error');
    } finally {
      setDeletingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskToDelete.id);
        return next;
      });
    }
  }, [deleteTask, deletingTaskIds, emitNotification, pendingDeleteTask, selectedTask]);

  const handleConfirmDeleteSelection = useCallback(async () => {
    if (!pendingDeleteTaskSelection || pendingDeleteTaskSelection.ids.length === 0) return;

    const idsToDelete = pendingDeleteTaskSelection.ids;

    try {
      setDeletingTaskIds((prev) => {
        const next = new Set(prev);
        idsToDelete.forEach((id) => next.add(id));
        return next;
      });

      let deletedCount = 0;
      for (const id of idsToDelete) {
        try {
          await deleteTask(id);
          deletedCount += 1;
        } catch {
          // keep going to avoid trapping the whole batch on one item
        }
      }

      if (selectedTask && idsToDelete.includes(selectedTask.id)) {
        setSelectedTask(null);
        setShowTaskDetails(false);
      }

      setPendingDeleteTaskSelection(null);

      if (deletedCount === idsToDelete.length) {
        emitNotification(
          'Lembretes removidos',
          `${deletedCount} lembrete${deletedCount === 1 ? '' : 's'} foram excluídos com sucesso.`,
          'info',
          { toastOnly: true },
        );
      } else if (deletedCount > 0) {
        emitNotification(
          'Exclusão parcial',
          `${deletedCount} de ${idsToDelete.length} lembretes foram excluídos.`,
          'warning',
        );
      } else {
        emitNotification('Erro', 'Falha ao excluir os lembretes selecionados.', 'error');
      }
    } finally {
      setDeletingTaskIds((prev) => {
        const next = new Set(prev);
        idsToDelete.forEach((id) => next.delete(id));
        return next;
      });
    }
  }, [deleteTask, emitNotification, pendingDeleteTaskSelection, selectedTask]);

  const handleConfirmDeleteNote = useCallback(async () => {
    if (!pendingDeleteNote) return;

    const noteToDelete = pendingDeleteNote;

    try {
      await deleteNote(noteToDelete.id);
      emitNotification('Nota removida', 'A nota foi excluida com sucesso.', 'info', { toastOnly: true });
      if (editingNote?.id === noteToDelete.id) {
        resetNoteForm();
      }
      setPendingDeleteNote(null);
    } catch {
      emitNotification('Erro', 'Falha ao excluir a nota.', 'error');
    }
  }, [deleteNote, editingNote?.id, emitNotification, pendingDeleteNote, resetNoteForm]);

  const openProfile = useCallback(() => {
    if (profileCloseTimerRef.current) {
      window.clearTimeout(profileCloseTimerRef.current);
      profileCloseTimerRef.current = null;
    }
    setShowNotificationsInbox(false);
    setProfName(auth.currentUser?.name || '');
    setProfEmail(auth.currentUser?.email || '');
    setProfPassword('');
    setProfAvatar(auth.currentUser?.avatar || null);
    setProfileSaveSuccess(false);
    setShowProfileDrawer(true);
  }, [auth.currentUser]);

  const handleUpdateProfile = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProfileSubmitting) return;

    try {
      setIsProfileSubmitting(true);
      setProfileSaveSuccess(false);
      const updatedProfile = await auth.updateProfile({
        name: profName,
        email: profEmail,
        password: profPassword || undefined,
        avatar: profAvatar,
      });
      emitNotification('Perfil atualizado!', 'Suas informações foram salvas.', 'success', {
        token: updatedProfile.token ?? auth.token,
        target: { type: 'profile' },
      });
      setProfileSaveSuccess(true);
      profileCloseTimerRef.current = window.setTimeout(() => {
        setShowProfileDrawer(false);
        setProfileSaveSuccess(false);
        profileCloseTimerRef.current = null;
      }, 1600);
    } catch (err: unknown) {
      setProfileSaveSuccess(false);
      emitNotification('Erro', err instanceof Error ? err.message : 'Falha ao atualizar perfil.', 'error');
    } finally {
      setIsProfileSubmitting(false);
    }
  }, [auth.updateProfile, emitNotification, isProfileSubmitting, profAvatar, profEmail, profName, profPassword]);

  const pendingTasks = useMemo(
    () => tasks.filter((task) => task.status === 'pending'),
    [tasks]
  );

  const completedTasks = useMemo(
    () => tasks.filter((task) => task.status === 'completed'),
    [tasks]
  );

  const pendingSummary = useMemo(() => {
    return pendingTasks.reduce(
      (summary, task) => {
        try {
          const dueDate = parseISO(task.dueDate);
          if (isPast(dueDate)) {
            summary.overdueCount += 1;
          } else if (isToday(dueDate)) {
            summary.todayCount += 1;
          }
        } catch {
          // ignore malformed dates in summary
        }

        return summary;
      },
      { todayCount: 0, overdueCount: 0 }
    );
  }, [pendingTasks]);

  const todayTasks = useMemo(() => {
    return pendingTasks.filter((task) => {
      try {
        const dueDate = parseISO(task.dueDate);
        return isToday(dueDate) && !isPast(dueDate);
      } catch {
        return false;
      }
    });
  }, [pendingTasks]);

  const tomorrowTasks = useMemo(() => {
    return pendingTasks.filter((task) => {
      try {
        return isTomorrow(parseISO(task.dueDate));
      } catch {
        return false;
      }
    });
  }, [pendingTasks]);

  const overdueTasks = useMemo(() => {
    return pendingTasks.filter((task) => {
      try {
        const dueDate = parseISO(task.dueDate);
        return isPast(dueDate);
      } catch {
        return false;
      }
    });
  }, [pendingTasks]);

  const timedPendingTasks = useMemo(() => {
    return pendingTasks.filter((task) => Boolean(getTaskTimeLabel(task.dueDate)));
  }, [pendingTasks]);

  const shouldSuppressHolidayNotification = useCallback((task: Task) => {
    if (!task.suppressHolidayNotifications) return false;

    try {
      return holidayDateKeys.has(format(parseISO(task.dueDate), 'yyyy-MM-dd'));
    } catch {
      return false;
    }
  }, [holidayDateKeys]);

  useEffect(() => {
    if (!notificationsEnabled || overdueTasks.length === 0) return;

    const now = new Date(notificationClock);

    overdueTasks.forEach((task) => {
      if (shouldSuppressHolidayNotification(task)) return;

      const dueDate = parseISO(task.dueDate);
      const minutesOverdue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / 60000));
      const overdueBucket = Math.floor(minutesOverdue / OVERDUE_REMINDER_INTERVAL_MINUTES);

      emitNotification(
        'Lembrete atrasado',
        overdueBucket === 0
          ? `"${task.title}" passou do prazo e precisa da sua atenção.`
          : `"${task.title}" continua atrasado há ${minutesOverdue} minuto${minutesOverdue === 1 ? '' : 's'}.`,
        'warning',
        {
          target: { type: 'task', taskId: task.id },
          dedupeKey: `overdue:${task.id}:${overdueBucket}`,
        },
      );
    });
  }, [emitNotification, notificationClock, notificationsEnabled, overdueTasks, shouldSuppressHolidayNotification]);

  useEffect(() => {
    if (!notificationsEnabled || timedPendingTasks.length === 0) return;

    const now = new Date(notificationClock);

    timedPendingTasks.forEach((task) => {
      if (shouldSuppressHolidayNotification(task)) return;

      const dueDate = parseISO(task.dueDate);
      const minutesUntil = getMinutesDifference(dueDate, now);

      if (minutesUntil < 0 || minutesUntil > UPCOMING_REMINDER_MINUTES) return;

      emitNotification(
        minutesUntil === 0
          ? 'Lembrete para agora'
          : `Lembrete em ${minutesUntil} minuto${minutesUntil === 1 ? '' : 's'}`,
        `"${task.title}" está chegando. Falta pouco para o horário definido.`,
        minutesUntil <= 5 ? 'warning' : 'info',
        {
          target: { type: 'task', taskId: task.id },
          dedupeKey: `upcoming:${task.id}:${format(dueDate, 'yyyy-MM-dd-HH-mm')}:${UPCOMING_REMINDER_MINUTES}`,
        },
      );
    });
  }, [emitNotification, notificationClock, notificationsEnabled, shouldSuppressHolidayNotification, timedPendingTasks]);

  useEffect(() => {
    if (!notificationsEnabled || todayTasks.length === 0) return;

    todayTasks.forEach((task) => {
      if (shouldSuppressHolidayNotification(task)) return;

      const dueDate = parseISO(task.dueDate);
      emitNotification(
        'Lembrete para hoje',
        `"${task.title}" está no radar de hoje.`,
        'info',
        {
          target: { type: 'task', taskId: task.id },
          dedupeKey: `today:${task.id}:${format(dueDate, 'yyyy-MM-dd')}`,
          skipToast: true,
        },
      );
    });
  }, [emitNotification, notificationClock, notificationsEnabled, shouldSuppressHolidayNotification, todayTasks]);

  useEffect(() => {
    if (!notificationsEnabled || tomorrowTasks.length === 0) return;

    tomorrowTasks.forEach((task) => {
      if (shouldSuppressHolidayNotification(task)) return;

      const dueDate = parseISO(task.dueDate);
      emitNotification(
        'Lembrete vindo amanhã',
        `"${task.title}" vence amanhã, então já vale se planejar.`,
        'info',
        {
          target: { type: 'task', taskId: task.id },
          dedupeKey: `tomorrow:${task.id}:${format(dueDate, 'yyyy-MM-dd')}`,
          skipToast: true,
        },
      );
    });
  }, [emitNotification, notificationClock, notificationsEnabled, shouldSuppressHolidayNotification, tomorrowTasks]);

  const openSettings = useCallback((view: SettingsView = 'appearance') => {
    setShowNotificationsInbox(false);
    setSettingsInitialView(view);
    setShowSettings(true);
  }, []);

  const closeProfileDrawer = useCallback(() => {
    if (profileCloseTimerRef.current) {
      window.clearTimeout(profileCloseTimerRef.current);
      profileCloseTimerRef.current = null;
    }
    setProfileSaveSuccess(false);
    setShowProfileDrawer(false);
  }, []);

  const closeSettingsDrawer = useCallback(() => {
    setShowSettings(false);
  }, []);

  const saveHolidayLocation = useCallback(async ({
    stateCode,
    cityName,
  }: {
    stateCode: string | null;
    cityName: string | null;
  }) => {
    try {
      setIsSavingHolidayLocation(true);
      await auth.updateProfile({
        stateCode,
        cityName,
      });
      await refreshHolidays(auth.token ?? undefined);
      emitNotification(
        'Região atualizada',
        'Os feriados agora consideram sua região configurada.',
        'success',
        { target: { type: 'settings' } },
      );
    } finally {
      setIsSavingHolidayLocation(false);
    }
  }, [auth, emitNotification, refreshHolidays]);

  const detectHolidayLocation = useCallback(async () => {
    if (!auth.token) throw new Error('Você precisa estar autenticado para detectar a região.');
    if (!navigator.geolocation) throw new Error('Seu navegador não oferece suporte à geolocalização.');

    setIsDetectingHolidayLocation(true);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 5 * 60 * 1000,
        });
      });

      const detected = await apiPost<{
        stateCode: string | null;
        cityName: string | null;
        regionCode: string | null;
      }>(
        '/api/tasks/holidays/location',
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
        auth.token,
      );

      await auth.updateProfile({
        stateCode: detected.stateCode,
        cityName: detected.cityName,
        holidayRegionCode: detected.regionCode,
      });
      await refreshHolidays(auth.token);

      emitNotification(
        'Localização aplicada',
        'Sua região foi identificada para mostrar os feriados corretos.',
        'success',
        { target: { type: 'settings' } },
      );
    } catch (error) {
      const message = error instanceof GeolocationPositionError
        ? error.code === error.PERMISSION_DENIED
          ? 'Permita o acesso à localização para detectar sua região.'
          : 'Não foi possível obter sua localização agora.'
        : error instanceof Error
          ? error.message
          : 'Não foi possível detectar sua região agora.';

      emitNotification('Falha na localização', message, 'error', {
        target: { type: 'settings' },
      });
      throw new Error(message);
    } finally {
      setIsDetectingHolidayLocation(false);
    }
  }, [auth, emitNotification, refreshHolidays]);

  const openHolidaySettings = useCallback(() => {
    openSettings('organization');
  }, [openSettings]);

  const closeFloatingSurfacesForNavigation = useCallback(() => {
    setShowNotificationsInbox(false);
    setShowSettings(false);
    setShowProfileDrawer(false);
    setDashboardMetricDialog(null);
    setTaskDetailsReturnMetric(null);
    setSelectedTask(null);
    setShowTaskDetails(false);
    setPendingNotificationTaskId(null);
    setPendingDeleteTask(null);
    setPendingDeleteNote(null);
    resetTaskForm();
    resetNoteForm();
  }, [resetNoteForm, resetTaskForm]);

  const openTasksTab = useCallback(() => {
    closeFloatingSurfacesForNavigation();
    setActiveTab('tasks');
  }, [closeFloatingSurfacesForNavigation]);

  const openNotesTab = useCallback(() => {
    closeFloatingSurfacesForNavigation();
    setActiveTab('notes');
  }, [closeFloatingSurfacesForNavigation]);

  const openDashboardTab = useCallback(() => {
    closeFloatingSurfacesForNavigation();
    setActiveTab('dashboard');
  }, [closeFloatingSurfacesForNavigation]);

  const openCalendarTab = useCallback(() => {
    closeFloatingSurfacesForNavigation();
    setActiveTab('calendar');
  }, [closeFloatingSurfacesForNavigation]);

  const openNotificationsCenter = useCallback(() => {
    closeFloatingSurfacesForNavigation();
    setActiveTab('notifications');
  }, [closeFloatingSurfacesForNavigation]);

  const openNotificationsInbox = useCallback(() => {
    setShowNotificationsInbox(true);
  }, []);

  const closeNotificationsInbox = useCallback(() => {
    setShowNotificationsInbox(false);
  }, []);

  useEffect(() => {
    if (!locationSearch) return;
    if (auth.restoring) return;

    const params = new URLSearchParams(locationSearch);
    const notificationTarget = params.get('notificationTarget');
    if (!notificationTarget) return;

    if (!auth.token) return;

    if (notificationTarget === 'task') {
      const taskId = params.get('taskId');
      if (taskId) {
        setActiveTab('tasks');
        setPendingNotificationTaskId(taskId);
      }
    } else if (notificationTarget === 'profile') {
      openProfile();
    } else if (notificationTarget === 'settings') {
      openSettings();
    } else {
      openNotificationsCenter();
    }

    params.delete('notificationTarget');
    params.delete('taskId');

    const nextSearch = params.toString();
    const nextUrl = nextSearch.length > 0
      ? `${window.location.pathname}?${nextSearch}`
      : window.location.pathname;

    window.history.replaceState({}, '', nextUrl);
    setLocationSearch(nextSearch.length > 0 ? `?${nextSearch}` : '');
  }, [
    auth.restoring,
    auth.token,
    locationSearch,
    openNotificationsCenter,
    openProfile,
    openSettings,
  ]);

  const handlePreviewNotification = useCallback((notification: AppNotification) => {
    if (notification.read || previewedNotificationIdsRef.current.has(notification.id)) return;

    previewedNotificationIdsRef.current.add(notification.id);
    void markNotificationRead(notification.id, true).catch(() => {
      previewedNotificationIdsRef.current.delete(notification.id);
    });
  }, [markNotificationRead]);

  const handleOpenNotification = useCallback((notification: AppNotification) => {
    if (!notification.read) {
      void markNotificationRead(notification.id, true).catch(() => {
        // keep navigation responsive even if read sync fails
      });
    }

    setShowNotificationsInbox(false);
    setShowSettings(false);

    if (notification.target?.type === 'task') {
      const taskTarget = notification.target;
      setActiveTab('tasks');
      setPendingNotificationTaskId(taskTarget.taskId);

      return;
    }

    if (notification.target?.type === 'profile') {
      openProfile();
      return;
    }

    if (notification.target?.type === 'settings') {
      openSettings();
      return;
    }

    setActiveTab('notifications');
  }, [markNotificationRead, openProfile, openSettings]);

  const dismissToast = useCallback(() => {
    setToastMsg(null);
  }, [setToastMsg]);

  const cancelDelete = useCallback(() => {
    if (!pendingDeleteTask || deletingTaskIds.has(pendingDeleteTask.id)) return;
    setPendingDeleteTask(null);
  }, [deletingTaskIds, pendingDeleteTask]);

  const cancelDeleteSelection = useCallback(() => {
    if (!pendingDeleteTaskSelection) return;
    const isConfirmingSelection = pendingDeleteTaskSelection.ids.some((id) => deletingTaskIds.has(id));
    if (isConfirmingSelection) return;
    setPendingDeleteTaskSelection(null);
  }, [deletingTaskIds, pendingDeleteTaskSelection]);

  const cancelDeleteNote = useCallback(() => {
    if (!pendingDeleteNote) return;
    setPendingDeleteNote(null);
  }, [pendingDeleteNote]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName;
      return (
        target.isContentEditable ||
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT'
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const isDeleteConfirming = Boolean(
        pendingDeleteTask && deletingTaskIds.has(pendingDeleteTask.id),
      );
      const isDeleteSelectionConfirming = Boolean(
        pendingDeleteTaskSelection && pendingDeleteTaskSelection.ids.some((id) => deletingTaskIds.has(id)),
      );

      if (event.key === 'Escape') {
        if (pendingDeleteNote) {
          event.preventDefault();
          cancelDeleteNote();
          return;
        }

        if (pendingDeleteTask && !isDeleteConfirming) {
          event.preventDefault();
          cancelDelete();
          return;
        }

        if (pendingDeleteTaskSelection && !isDeleteSelectionConfirming) {
          event.preventDefault();
          cancelDeleteSelection();
          return;
        }

        if (showTaskDetails) {
          event.preventDefault();
          closeTaskDetails();
          return;
        }

        if (dashboardMetricDialog) {
          event.preventDefault();
          closeDashboardMetric();
          return;
        }

        if (showTaskDrawer) {
          event.preventDefault();
          resetTaskForm();
          return;
        }

        if (showNoteDrawer) {
          event.preventDefault();
          resetNoteForm();
          return;
        }

        if (showProfileDrawer) {
          event.preventDefault();
          closeProfileDrawer();
          return;
        }

        if (showSettings) {
          event.preventDefault();
          closeSettingsDrawer();
          return;
        }

        if (showNotificationsInbox) {
          event.preventDefault();
          closeNotificationsInbox();
        }
      }

      if (event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const hasOverlayOpen =
          showTaskDrawer ||
          showNoteDrawer ||
          showTaskDetails ||
          showProfileDrawer ||
          showSettings ||
          showNotificationsInbox ||
          Boolean(pendingDeleteTask) ||
          Boolean(pendingDeleteTaskSelection) ||
          Boolean(dashboardMetricDialog);

        if (!auth.currentUser || !auth.token || hasOverlayOpen || isTypingTarget(event.target)) return;

        event.preventDefault();
        openNewTask();
      }

      if (event.key === 'Enter' && pendingDeleteTask && !isDeleteConfirming) {
        const dialog = document.querySelector('[data-testid="confirm-dialog"]');
        const activeElement = document.activeElement;

        if (
          dialog &&
          activeElement instanceof HTMLElement &&
          dialog.contains(activeElement) &&
          activeElement.tagName !== 'TEXTAREA'
        ) {
          event.preventDefault();
          void handleConfirmDelete();
        }
      }

      if (event.key === 'Enter' && pendingDeleteTaskSelection && !isDeleteSelectionConfirming) {
        const dialog = document.querySelector('[data-testid="confirm-dialog"]');
        const activeElement = document.activeElement;

        if (
          dialog &&
          activeElement instanceof HTMLElement &&
          dialog.contains(activeElement) &&
          activeElement.tagName !== 'TEXTAREA'
        ) {
          event.preventDefault();
          void handleConfirmDeleteSelection();
        }
      }

      if (event.key === 'Enter' && pendingDeleteNote) {
        const dialog = document.querySelector('[data-testid="confirm-dialog"]');
        const activeElement = document.activeElement;

        if (
          dialog &&
          activeElement instanceof HTMLElement &&
          dialog.contains(activeElement) &&
          activeElement.tagName !== 'TEXTAREA'
        ) {
          event.preventDefault();
          void handleConfirmDeleteNote();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    auth.currentUser,
    auth.token,
    cancelDelete,
    cancelDeleteSelection,
    cancelDeleteNote,
    closeDashboardMetric,
    closeNotificationsInbox,
    closeProfileDrawer,
    closeSettingsDrawer,
    closeTaskDetails,
    dashboardMetricDialog,
    deletingTaskIds,
    handleConfirmDelete,
    handleConfirmDeleteSelection,
    handleConfirmDeleteNote,
    openNewTask,
    pendingDeleteNote,
    pendingDeleteTask,
    pendingDeleteTaskSelection,
    resetTaskForm,
    resetNoteForm,
    showNotificationsInbox,
    showNoteDrawer,
    showProfileDrawer,
    showSettings,
    showTaskDetails,
    showTaskDrawer,
  ]);

  const navigateTo = useCallback((nextPath: string) => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setPathname(nextPath);
    setLocationSearch(window.location.search);
  }, []);

  if (isResetPasswordRoute) {
    return <ResetPage onBackToLogin={() => navigateTo('/')} />;
  }

  if (auth.restoring) {
    return <LoadingScreen />;
  }

  if (!auth.currentUser || !auth.token) {
    return (
      <AuthPage
        auth={auth}
        toastNotify={(title, message) => emitNotification(title, message, 'success', {
          target: { type: 'notifications' },
        })}
      />
    );
  }

  const greetingName = auth.currentUser.name.split(' ')[0];
  const pageTitle = activeTab === 'dashboard'
    ? `Olá, ${greetingName}`
    : activeTab === 'calendar'
      ? 'Seu calendário'
    : activeTab === 'tasks'
      ? 'Sua agenda'
      : activeTab === 'notes'
        ? 'Suas notas'
      : 'Notificações';
  const pageDescription = activeTab === 'dashboard'
    ? ''
    : activeTab === 'calendar'
      ? 'Visualize seus lembretes por dia, semana e mês em uma grade de calendário.'
    : activeTab === 'tasks'
      ? 'Organize lembretes, refine prioridades e avance com tranquilidade.'
      : activeTab === 'notes'
        ? 'Guarde contexto, ideias e apontamentos vinculados aos seus lembretes.'
      : 'Acompanhe tudo o que o sistema registrou para você recentemente.';
  const dashboardMetricContent = dashboardMetricDialog === 'completed'
    ? {
        title: 'Lembretes conclu\u00eddos',
        description: 'Tudo o que voc\u00ea finalizou recentemente, com acesso r\u00e1pido para reabrir ou revisar detalhes.',
        tasks: completedTasks,
        countLabel: `${completedTasks.length} conclu\u00eddo${completedTasks.length === 1 ? '' : 's'}`,
      }
    : dashboardMetricDialog === 'today'
      ? {
        title: 'Lembretes para hoje',
        description: 'Aqui est\u00e3o os itens planejados para hoje, prontos para ganhar prioridade e execu\u00e7\u00e3o.',
        tasks: todayTasks,
        countLabel: `${todayTasks.length} para hoje`,
      }
      : dashboardMetricDialog === 'overdue'
        ? {
            title: 'Lembretes atrasados',
            description: 'Uma vis\u00e3o dedicada do que passou do prazo para voc\u00ea reorganizar sem perder contexto.',
            tasks: overdueTasks,
            countLabel: `${overdueTasks.length} atrasado${overdueTasks.length === 1 ? '' : 's'}`,
          }
        : null;
  const taskDetailsBackLabel = taskDetailsReturnMetric === 'completed'
    ? 'Voltar para concluídos'
    : taskDetailsReturnMetric === 'today'
      ? 'Voltar para hoje'
      : taskDetailsReturnMetric === 'overdue'
        ? 'Voltar para atrasados'
        : '';

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] w-full overflow-hidden text-slate-900 dark:text-slate-100">
      <Sidebar
        currentUser={auth.currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        filterCategory={filterCategory}
        setFilterCategory={setFilterCategory}
        categories={categoryOptions}
        pendingTasks={pendingTasks}
        overdueCount={pendingSummary.overdueCount}
        onOpenProfile={openProfile}
        onOpenSettings={openSettings}
        onLogout={auth.logout}
      />

      <main className="relative flex h-full flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 dark:opacity-20" />

        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/70 bg-white/80 p-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/75 sm:p-4 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_18px_30px_-22px_rgba(37,99,235,0.8)]">
              <Sparkles size={18} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Painel</p>
              <h1 className="text-lg font-semibold">Lembreto</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <motion.button
              onClick={showNotificationsInbox ? closeNotificationsInbox : openNotificationsInbox}
              aria-label="Abrir notificações recentes"
              data-testid="header-notifications-button-mobile"
              className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
            >
              <BellRing size={20} className={unreadNotifications > 0 ? 'animate-bell-attention' : ''} />
              {unreadNotifications > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {Math.min(unreadNotifications, 9)}
                </span>
              )}
            </motion.button>
            <button
              onClick={() => openSettings()}
              aria-label="Abrir configurações"
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

        <div className="relative mx-auto flex-1 w-full max-w-7xl p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8 lg:pb-8 xl:p-10">
          {!(activeTab === 'dashboard' && isMobileViewport) && (
            <div className="surface-panel mb-6 p-5 md:mb-8 md:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <span className="section-eyebrow">
                    {activeTab === 'dashboard'
                      ? 'Painel principal'
                      : activeTab === 'calendar'
                        ? 'Calendário'
                      : activeTab === 'notes'
                        ? 'Caderno pessoal'
                        : activeTab === 'notifications'
                          ? 'Central de notificações'
                          : 'Gestão de lembretes'}
                  </span>
                  <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-4xl">
                    {pageTitle}
                  </h2>
                  {pageDescription && (
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400 md:text-base">
                      {pageDescription}
                    </p>
                  )}
                </div>

                <div className="hidden items-center gap-3 lg:flex">
                  <motion.button
                    type="button"
                    onClick={showNotificationsInbox ? closeNotificationsInbox : openNotificationsInbox}
                    data-testid="header-notifications-button"
                    aria-label="Abrir notificações recentes"
                    className="relative inline-flex h-14 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-slate-700 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-100 dark:hover:border-white/20 dark:hover:bg-white/[0.08]"
                  >
                    <span className="icon-slot h-5 w-5">
                      <BellRing size={20} className={unreadNotifications > 0 ? 'animate-bell-attention' : ''} />
                    </span>
                    {unreadNotifications > 0 && (
                      <span className="absolute -right-2 -top-2 inline-flex min-w-6 items-center justify-center rounded-full bg-rose-500 px-1.5 py-1 text-[10px] font-bold text-white shadow-[0_10px_20px_-12px_rgba(244,63,94,0.8)]">
                        {Math.min(unreadNotifications, 99)}
                      </span>
                    )}
                  </motion.button>
                </div>
              </div>
            </div>
          )}

          <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            {activeTab === 'tasks' && (
              <button
                onClick={openNewTask}
                data-testid="new-task-button"
                className="action-primary hidden lg:inline-flex"
              >
                <Plus size={20} /> Novo lembrete
              </button>
            )}
            {activeTab === 'notes' && (
              <button
                onClick={() => openNewNote()}
                data-testid="new-note-header-button"
                className="action-primary hidden lg:inline-flex"
              >
                <Plus size={20} /> Nova nota
              </button>
            )}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={isMobileViewport ? { opacity: 0, x: tabAnimationDirection * 28 } : { opacity: 0, y: 10 }}
              animate={isMobileViewport ? { opacity: 1, x: 0 } : { opacity: 1, y: 0 }}
              exit={isMobileViewport ? { opacity: 0, x: tabAnimationDirection * -28 } : { opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {activeTab === 'dashboard' && (
                <DashboardPage
                  tasks={tasks}
                  pendingTasks={pendingTasks}
                  completedTasks={completedTasks}
                  todayCount={pendingSummary.todayCount}
                  overdueCount={pendingSummary.overdueCount}
                  onViewAll={openTasksTab}
                  onOpenCompleted={() => openDashboardMetric('completed')}
                  onOpenToday={() => openDashboardMetric('today')}
                  onOpenOverdue={() => openDashboardMetric('overdue')}
                  onNewTask={openNewTask}
                  onApplyTemplate={openTaskFromTemplate}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEdit={openTaskDetails}
                  deletingTaskIds={deletingTaskIds}
                  togglingTaskIds={togglingTaskIds}
                />
              )}
              {activeTab === 'calendar' && (
                <CalendarPage
                  tasks={tasks}
                  categories={categoryOptions}
                  tags={tagOptions}
                  onNewTask={openNewTask}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEdit={openTaskDetails}
                  deletingTaskIds={deletingTaskIds}
                  togglingTaskIds={togglingTaskIds}
                />
              )}
              {activeTab === 'tasks' && (
                <TasksPage
                  pendingTasks={pendingTasks}
                  completedTasks={completedTasks}
                  categories={categoryOptions}
                  tags={tagOptions}
                  filterCategory={filterCategory}
                  setFilterCategory={setFilterCategory}
                  search={search}
                  setSearch={setSearch}
                  showCompleted={configShowCompleted}
                  onNewTask={openNewTask}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onDeleteSelected={handleDeleteSelectedTasks}
                  onEdit={openTaskDetails}
                  deletingTaskIds={deletingTaskIds}
                  togglingTaskIds={togglingTaskIds}
                  holidayCalendar={holidayCalendar}
                  isHolidayLoading={isHolidayLoading}
                  isDetectingHolidayLocation={isDetectingHolidayLocation}
                  onRefreshHolidays={() => {
                    void refreshHolidays();
                  }}
                  onDetectHolidayLocation={() => {
                    void detectHolidayLocation();
                  }}
                  onOpenHolidaySettings={openHolidaySettings}
                />
              )}
              {activeTab === 'notes' && (
                <NotesPage
                  notes={notes}
                  tasks={tasks}
                  categories={categoryOptions}
                  onNewNote={() => openNewNote()}
                  onEditNote={(note) => openEditNote(note)}
                  onDeleteNote={handleDeleteNote}
                />
              )}
              {activeTab === 'notifications' && (
                <NotificationsPage
                  notifications={notifications}
                  onMarkAllRead={markAllNotificationsRead}
                  onClearAll={clearNotifications}
                  onOpenNotification={handleOpenNotification}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/80 bg-white/92 pb-[max(env(safe-area-inset-bottom),0px)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/88 lg:hidden">
        <div className="grid grid-cols-[1fr_1fr_auto_1fr_1fr] items-center gap-1 p-2">
          <button
            onClick={openDashboardTab}
            aria-label="Abrir dashboard"
            className={cn(
              'flex flex-col items-center rounded-2xl p-3 transition-colors',
              activeTab === 'dashboard' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'text-slate-500'
            )}
            >
              <Sparkles size={24} />
            </button>
          <button
            onClick={openCalendarTab}
            aria-label="Abrir calendário"
            className={cn(
              'flex flex-col items-center rounded-2xl p-3 transition-colors',
              activeTab === 'calendar' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'text-slate-500',
            )}
          >
            <CalendarDays size={24} />
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
            {pendingSummary.overdueCount > 0 && (
              <span className="absolute right-1 top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-[0_10px_20px_-12px_rgba(244,63,94,0.8)]">
                {Math.min(pendingSummary.overdueCount, 99)}
              </span>
            )}
          </button>
          <button
            onClick={openNotesTab}
            aria-label="Abrir notas"
            className={cn(
              'flex flex-col items-center rounded-2xl p-3 transition-colors',
              activeTab === 'notes' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'text-slate-500',
            )}
          >
            <NotebookPen size={24} />
          </button>
        </div>
      </nav>

      <TaskDetailsDialog
        open={showTaskDetails && Boolean(selectedTask)}
        task={selectedTask}
        linkedNotes={selectedTask ? notesByTask.get(selectedTask.id) ?? [] : []}
        isDeleting={selectedTask ? deletingTaskIds.has(selectedTask.id) : false}
        isToggling={selectedTask ? togglingTaskIds.has(selectedTask.id) : false}
        isRescheduling={selectedTask ? reschedulingTaskIds.has(selectedTask.id) : false}
        backLabel={taskDetailsBackLabel || undefined}
        onClose={closeTaskDetails}
        onBack={taskDetailsReturnMetric ? returnToDashboardMetric : undefined}
        onEdit={openEditTask}
        onDuplicate={openDuplicateTask}
        onShare={handleShareTask}
        onQuickReschedule={handleQuickReschedule}
        onToggle={handleToggleFromDetails}
        onDelete={handleDeleteFromDetails}
        onCreateLinkedNote={openNewNote}
        onEditLinkedNote={(note, task) => openEditNote(note, { taskContextId: task.id })}
        onDeleteLinkedNote={handleDeleteNote}
      />

      <DashboardMetricDialog
        open={Boolean(dashboardMetricContent)}
        title={dashboardMetricContent?.title ?? ''}
        description={dashboardMetricContent?.description ?? ''}
        tasks={dashboardMetricContent?.tasks ?? []}
        countLabel={dashboardMetricContent?.countLabel ?? ''}
        onClose={closeDashboardMetric}
        onOpenAll={() => {
          closeDashboardMetric();
          openTasksTab();
        }}
        onToggle={handleToggle}
        onDelete={handleDelete}
        onEdit={(task) => {
          if (dashboardMetricDialog) {
            openTaskDetailsFromMetric(task, dashboardMetricDialog);
          }
        }}
        deletingTaskIds={deletingTaskIds}
        togglingTaskIds={togglingTaskIds}
      />

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
        categoryOptions={categoryOptions}
        tags={formTags}
        setTags={setFormTags}
        tagOptions={tagOptions}
        recurrenceEnabled={formRecurrenceEnabled}
        setRecurrenceEnabled={setFormRecurrenceEnabled}
        recurrenceMode={formRecurrenceMode}
        setRecurrenceMode={setFormRecurrenceMode}
        recurrenceUntil={formRecurrenceUntil}
        setRecurrenceUntil={setFormRecurrenceUntil}
        suppressHolidayNotifications={formSuppressHolidayNotifications}
        setSuppressHolidayNotifications={setFormSuppressHolidayNotifications}
        recurrenceError={recurrenceError}
        recurrencePreviewCount={recurringDates.length}
        holidaySuppressedCount={recurringHolidaySuppressedCount}
        onApplyRecurrenceSuggestion={applyRecurrenceSuggestion}
      />

      <NoteDrawer
        open={showNoteDrawer}
        onClose={resetNoteForm}
        onSubmit={handleSubmitNote}
        editingNote={editingNote}
        isSubmitting={isNoteSubmitting}
        title={noteTitle}
        setTitle={setNoteTitle}
        content={noteContent}
        setContent={setNoteContent}
        priority={notePriority}
        setPriority={setNotePriority}
        category={noteCategory}
        setCategory={setNoteCategory}
        categoryOptions={categoryOptions}
        tags={noteTags}
        setTags={setNoteTags}
        tagOptions={tagOptions}
        mode={noteMode}
        setMode={setNoteMode}
        taskId={noteTaskId}
        setTaskId={setNoteTaskId}
        tasks={tasks}
        lockedTask={noteContextTask}
      />

      <ProfileDrawer
        open={showProfileDrawer}
        onClose={closeProfileDrawer}
        onSubmit={handleUpdateProfile}
        onLogout={auth.logout}
        currentUser={auth.currentUser}
        isSubmitting={isProfileSubmitting}
        saveSuccess={profileSaveSuccess}
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
        initialView={settingsInitialView}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={() => {
          void handleToggleNotifications();
        }}
        desktopNotificationsSupported={pushSupported}
        desktopNotificationsReady={desktopNotificationsReady}
        desktopNotificationsPermission={notifPerm}
        desktopNotificationsConfigured={pushConfigured}
        desktopNotificationsError={desktopPushError}
        isSyncingDesktopNotifications={isSyncingDesktopNotifications}
        onEnableDesktopNotifications={() => {
          void handleEnableDesktopNotifications();
        }}
        onOpenNotificationsCenter={openNotificationsCenter}
        onOpenProfile={openProfile}
        sound={configSound}
        onToggleSound={() => saveConfig({ sound: !configSound })}
        confirmDelete={configConfirmDelete}
        onToggleConfirmDelete={() => saveConfig({ confirmDelete: !configConfirmDelete })}
        showCompleted={configShowCompleted}
        onToggleShowCompleted={() => saveConfig({ showCompleted: !configShowCompleted })}
        categories={categoryOptions}
        tags={tagOptions}
        onCreateCategory={createCategory}
        onCreateTag={createTag}
        onDeleteCategory={handleDeleteCategory}
        onDeleteTag={handleDeleteTag}
        holidayStateCode={auth.currentUser?.stateCode ?? null}
        holidayCityName={auth.currentUser?.cityName ?? null}
        holidayMatchedRegionName={holidayCalendar?.location.matchedRegionName ?? null}
        holidayMunicipalSupported={holidayCalendar?.location.municipalSupported ?? false}
        holidaySupportedCities={holidayCalendar?.supportedCities ?? []}
        isSavingHolidayLocation={isSavingHolidayLocation}
        isDetectingHolidayLocation={isDetectingHolidayLocation}
        onSaveHolidayLocation={saveHolidayLocation}
        onDetectHolidayLocation={detectHolidayLocation}
      />

      <NotificationsInboxDrawer
        open={showNotificationsInbox}
        notifications={notifications}
        unreadCount={unreadNotifications}
        onClose={closeNotificationsInbox}
        onOpenNotification={handleOpenNotification}
        onPreviewNotification={handlePreviewNotification}
        onOpenCenter={openNotificationsCenter}
      />

      <Toast toast={toastMsg} onDismiss={dismissToast} />

      <ConfirmDialog
        open={Boolean(pendingDeleteTask || pendingDeleteTaskSelection || pendingDeleteNote)}
        title={
          pendingDeleteTask
            ? 'Excluir lembrete?'
            : pendingDeleteTaskSelection
              ? `Excluir ${pendingDeleteTaskSelection.count} lembretes?`
              : 'Excluir nota?'
        }
        message={
          pendingDeleteTask
            ? `Você está prestes a excluir "${pendingDeleteTask.title}" permanentemente.`
            : pendingDeleteTaskSelection
              ? `Você está prestes a excluir ${pendingDeleteTaskSelection.count} lembrete${pendingDeleteTaskSelection.count === 1 ? '' : 's'} permanentemente.`
            : pendingDeleteNote
              ? `Você está prestes a excluir "${pendingDeleteNote.title}" permanentemente.`
              : ''
        }
        confirmLabel={
          pendingDeleteTask
            ? 'Excluir lembrete'
            : pendingDeleteTaskSelection
              ? 'Excluir lembretes'
              : 'Excluir nota'
        }
        cancelLabel={
          pendingDeleteTask
            ? 'Manter lembrete'
            : pendingDeleteTaskSelection
              ? 'Manter lembretes'
              : 'Manter nota'
        }
        isConfirming={
          pendingDeleteTask
            ? deletingTaskIds.has(pendingDeleteTask.id)
            : pendingDeleteTaskSelection
              ? pendingDeleteTaskSelection.ids.some((id) => deletingTaskIds.has(id))
              : false
        }
        onConfirm={() => {
          if (pendingDeleteTask) {
            void handleConfirmDelete();
            return;
          }
          if (pendingDeleteTaskSelection) {
            void handleConfirmDeleteSelection();
            return;
          }
          void handleConfirmDeleteNote();
        }}
        onCancel={
          pendingDeleteTask
            ? cancelDelete
            : pendingDeleteTaskSelection
              ? cancelDeleteSelection
              : cancelDeleteNote
        }
      />
    </div>
  );
}


