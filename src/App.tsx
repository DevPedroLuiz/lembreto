import React, {
  Suspense,
  lazy,
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
  PanelLeftOpen,
  Plus,
  Settings,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';
import { addDays, addHours, addMinutes, format, isPast, isToday, isTomorrow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AnimatePresence, motion } from 'motion/react';

import { apiGet, apiPost, buildHeaders } from './api/client';
import { useAuth } from './hooks/useAuth';
import { useCalendarIntegrations } from './hooks/useCalendarIntegrations';
import { useHolidays } from './hooks/useHolidays';
import { useAlarmSound } from './hooks/useAlarmSound';
import { useAppConfig } from './hooks/useAppConfig';
import { useNotes } from './hooks/useNotes';
import { useNotifications } from './hooks/useNotifications';
import { usePushNotifications } from './hooks/usePushNotifications';
import { useTasks } from './hooks/useTasks';
import { useToast } from './hooks/useToast';
import { cn } from './lib/cn';
import { AUTH_UNAUTHORIZED_EVENT } from './lib/authEvents';
import {
  buildDueDateFromForm,
  formatDateInputValue,
  formatTimeInputValue,
  formatMinutesAsTimeInput,
  getTaskTimeLabel,
  parseDueDateToForm,
} from './lib/taskDueDate';
import { getDerivedTaskStatus, getDerivedTaskStatusLabel } from './lib/taskStatus';
import {
  buildOverdueExpiresAt,
  formatOverdueDuration,
  getOverdueReminderSequence,
} from '../lib/overdue-reminders';
import {
  buildRecurringDates,
  countDateKeyMatches,
  getRecurrenceSuggestion,
  getRecurrenceValidationError,
  type RecurrenceMode,
  type RecurrenceSuggestion,
} from './lib/taskRecurrence';
import {
  DEFAULT_CATEGORIES,
  type AppNotification,
  type Note,
  type NoteMode,
  type NotificationTarget,
  type OverdueNotificationSnoozePreset,
  type Priority,
  type Task,
  type TaskOverdueReminderIntensity,
} from './types';
import { LoadingScreen } from './components/LoadingScreen';
import { Sidebar } from './components/Sidebar';
import type { SettingsView } from './components/SettingsDrawer';
import { Toast } from './components/Toast';
import { ConfirmDialog } from './components/ConfirmDialog';
import type { QuickStartTemplate } from './pages/DashboardPage';
import type { TasksPageView } from './pages/TasksPage';

const AuthPage = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })));
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((module) => ({ default: module.CalendarPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const NotesPage = lazy(() => import('./pages/NotesPage').then((module) => ({ default: module.NotesPage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })));
const ResetPage = lazy(() => import('./pages/ResetPage').then((module) => ({ default: module.ResetPage })));
const TasksPage = lazy(() => import('./pages/TasksPage').then((module) => ({ default: module.TasksPage })));

const DashboardMetricDialog = lazy(() => import('./components/DashboardMetricDialog').then((module) => ({ default: module.DashboardMetricDialog })));
const NoteDrawer = lazy(() => import('./components/NoteDrawer').then((module) => ({ default: module.NoteDrawer })));
const NotificationsInboxDrawer = lazy(() => import('./components/NotificationsInboxDrawer').then((module) => ({ default: module.NotificationsInboxDrawer })));
const ProfileDrawer = lazy(() => import('./components/ProfileDrawer').then((module) => ({ default: module.ProfileDrawer })));
const SettingsDrawer = lazy(() => import('./components/SettingsDrawer').then((module) => ({ default: module.SettingsDrawer })));
const TaskDetailsDialog = lazy(() => import('./components/TaskDetailsDialog').then((module) => ({ default: module.TaskDetailsDialog })));
const TaskDrawer = lazy(() => import('./components/TaskDrawer').then((module) => ({ default: module.TaskDrawer })));

function PageChunkFallback() {
  return (
    <div className="surface-panel flex min-h-[320px] items-center justify-center p-8 text-sm font-medium text-slate-500 dark:text-slate-400">
      Carregando área...
    </div>
  );
}

function useHasBeenOpened(open: boolean) {
  const [hasBeenOpened, setHasBeenOpened] = useState(open);

  useEffect(() => {
    if (open) setHasBeenOpened(true);
  }, [open]);

  return hasBeenOpened;
}

type DashboardMetricKey = 'completed' | 'today' | 'overdue';
type ViewTab = 'dashboard' | 'calendar' | 'tasks' | 'notes' | 'notifications';

type NotificationTone = 'info' | 'success' | 'warning' | 'error';
type QuickReschedulePreset = 'laterToday' | 'tomorrowMorning' | 'nextWeek';
type TaskWithDueDate = Task & { dueDate: string };

type EmitNotificationOptions = {
  toastOnly?: boolean;
  skipToast?: boolean;
  target?: NotificationTarget;
  dedupeKey?: string;
  token?: string | null;
};

type LocalNotificationOptions = Pick<EmitNotificationOptions, 'skipToast' | 'target' | 'dedupeKey'>;
type LocalNotificationAction = {
  action: string;
  title: string;
};

type LocalDesktopNotificationOptions = LocalNotificationOptions & {
  kind?: AppNotification['kind'];
  actions?: LocalNotificationAction[];
};

type CalendarFeedResponse = {
  feedPath: string;
  expiresAt: string;
  revokedCount: number;
};

const UPCOMING_REMINDER_MINUTES = 15;
const ALARM_SNOOZE_MINUTES = 10;
const OVERDUE_VIEWED_MUTE_MINUTES = 30;
const ALARM_RING_DURATION_MS = 2 * 60 * 1000;

type ActiveAlarm = {
  scheduleId?: string;
  notificationId?: string;
  dedupeKey?: string;
  taskId: string;
  taskTitle: string;
  dueDate: string;
  startedAt: number;
};

const DISMISSED_ALARMS_STORAGE_KEY = 'lembreto.dismissedAlarms.v1';
const LOCAL_NOTIFICATION_DEDUPE_STORAGE_KEY = 'lembreto.localNotificationDedupe.v1';

function hasTaskDueDate(task: Task): task is TaskWithDueDate {
  return typeof task.dueDate === 'string' && task.dueDate.length > 0;
}

function normalizeCategoryForValidation(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

function isWorkCategory(value: string): boolean {
  return normalizeCategoryForValidation(value) === 'trabalho';
}

function readDismissedAlarmKeys(): string[] {
  return readStringListFromLocalStorage(DISMISSED_ALARMS_STORAGE_KEY);
}

function readStringListFromLocalStorage(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function rememberDismissedAlarmKey(key: string) {
  rememberStringInLocalStorage(DISMISSED_ALARMS_STORAGE_KEY, key);
}

function rememberStringInLocalStorage(storageKey: string, value: string) {
  try {
    const keys = new Set(readStringListFromLocalStorage(storageKey));
    keys.add(value);
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(Array.from(keys).slice(-200)),
    );
  } catch {
    // Local dedupe is best effort; backend state is still authoritative online.
  }
}

function buildAlarmInstanceKey(input: {
  scheduleId?: string;
  dedupeKey?: string;
  taskId: string;
  dueDate: string | null;
}) {
  if (input.dedupeKey) return input.dedupeKey;
  if (input.scheduleId) return `schedule:${input.scheduleId}`;
  if (!input.dueDate) return `${input.taskId}:floating`;
  const dueDate = parseISO(input.dueDate);
  return `${input.taskId}:${format(dueDate, 'yyyy-MM-dd-HH-mm')}`;
}

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
  let dueLabel = task.dueDate ? 'Data indisponível' : 'Sem início';

  if (task.dueDate) {
    try {
      dueLabel = format(parseISO(task.dueDate), "dd 'de' MMMM 'de' yyyy", {
        locale: ptBR,
      });
    } catch {
      // keep fallback
    }
  }

  const timeLabel = getTaskTimeLabel(task.dueDate);
  const endTimeLabel = task.endDate ? getTaskTimeLabel(task.endDate) : null;
  const timeRangeLabel = timeLabel && endTimeLabel ? `${timeLabel} - ${endTimeLabel}` : timeLabel;
  const statusLabel = getDerivedTaskStatusLabel(getDerivedTaskStatus(task));

  return [
    `Lembrete: ${task.title}`,
    task.description?.trim() ? `Detalhes: ${task.description.trim()}` : null,
    `Prazo: ${dueLabel}`,
    `Horário: ${timeRangeLabel || 'Dia todo'}`,
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
    return buildDueDateFromForm(formatDateInputValue(nextWeek), dueDateForm.time || '09:00');
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

function buildOverdueNotificationSnoozeDate(task: Task, preset: OverdueNotificationSnoozePreset): Date {
  if (preset === 'tenMinutes') {
    const date = addMinutes(new Date(), 10);
    date.setSeconds(0, 0);
    return date;
  }

  if (preset === 'oneHour') {
    const date = addHours(new Date(), 1);
    date.setSeconds(0, 0);
    return date;
  }

  const currentDue = parseDueDateToForm(task.dueDate);
  const tomorrow = addDays(new Date(), 1);
  return new Date(buildDueDateFromForm(formatDateInputValue(tomorrow), currentDue.time || '09:00'));
}

function buildOverdueNotificationSnoozePayload(task: Task, preset: OverdueNotificationSnoozePreset) {
  const nextDueDate = buildOverdueNotificationSnoozeDate(task, preset);
  const payload: {
    dueDate: string;
    endDate?: string | null;
    status: 'pending';
  } = {
    dueDate: nextDueDate.toISOString(),
    status: 'pending',
  };

  if (task.dueDate && task.endDate) {
    const currentDueDate = new Date(task.dueDate);
    const currentEndDate = new Date(task.endDate);
    if (
      !Number.isNaN(currentDueDate.getTime()) &&
      !Number.isNaN(currentEndDate.getTime()) &&
      currentEndDate > currentDueDate
    ) {
      payload.endDate = new Date(nextDueDate.getTime() + (currentEndDate.getTime() - currentDueDate.getTime())).toISOString();
    }
  }

  return payload;
}

function getOverdueNotificationSnoozeLabel(preset: OverdueNotificationSnoozePreset) {
  if (preset === 'tenMinutes') return 'em 10 minutos';
  if (preset === 'oneHour') return 'em 1 hora';
  return 'amanhã';
}

function isOverdueNotificationSnoozePreset(value: string | null): value is OverdueNotificationSnoozePreset {
  return value === 'tenMinutes' || value === 'oneHour' || value === 'tomorrow';
}

function formatDateTimeLocalValue(isoDate: string | Date | null | undefined): string {
  if (!isoDate) return '';
  const date = isoDate instanceof Date ? isoDate : new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDateInputValue(date)}T${formatTimeInputValue(date)}`;
}

function buildDefaultNoteExpiry(): string {
  return formatDateTimeLocalValue(addDays(new Date(), 1));
}

function buildIsoFromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getMinutesDifference(targetDate: Date, referenceDate: Date) {
  return Math.floor((targetDate.getTime() - referenceDate.getTime()) / 60000);
}

function buildNotificationNavigationPath(target?: NotificationTarget) {
  const params = new URLSearchParams();

  if (target?.type === 'task') {
    params.set('notificationTarget', 'task');
    params.set('taskId', target.taskId);
  } else if (target?.type === 'profile') {
    params.set('notificationTarget', 'profile');
  } else if (target?.type === 'settings') {
    params.set('notificationTarget', 'settings');
  } else {
    params.set('notificationTarget', 'notifications');
  }

  const query = params.toString();
  return query.length > 0 ? `/?${query}` : '/';
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
    refreshTasks,
    pendingOfflineTaskCount,
    isSyncingOfflineTasks,
  } = useTasks(
    isResetPasswordRoute ? null : auth.token,
    isResetPasswordRoute ? null : auth.currentUser,
  );
  const {
    integrations: calendarIntegrations,
    isLoading: isLoadingCalendarIntegrations,
    refreshCalendarIntegrations,
    connectCalendar,
    updateCalendarSync,
    disconnectCalendar,
    syncTaskNow,
    syncAllNow,
  } = useCalendarIntegrations(isResetPasswordRoute ? null : auth.token);
  const {
    notes,
    trashedNotes,
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
    processDueNotifications,
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
  const {
    darkMode,
    notificationsEnabled,
    setNotificationsEnabled,
    desktopNotificationsEnabled,
    configSound,
    configConfirmDelete,
    configShowCompleted,
    configNoTimeReminderMinutes,
    saveConfig,
    toggleDarkMode,
  } = useAppConfig();

  const [activeTab, setActiveTab] = useState<ViewTab>('dashboard');
  const [tasksPageView, setTasksPageView] = useState<TasksPageView>('agenda');
  const [filterCategory, setFilterCategory] = useState('Todas');
  const [search, setSearch] = useState('');

  const [showTaskDrawer, setShowTaskDrawer] = useState(false);
  const [showNoteDrawer, setShowNoteDrawer] = useState(false);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotificationsInbox, setShowNotificationsInbox] = useState(false);
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [settingsInitialView, setSettingsInitialView] = useState<SettingsView>('appearance');
  const shouldRenderTaskDrawer = useHasBeenOpened(showTaskDrawer);
  const shouldRenderNoteDrawer = useHasBeenOpened(showNoteDrawer);
  const shouldRenderProfileDrawer = useHasBeenOpened(showProfileDrawer);
  const shouldRenderSettingsDrawer = useHasBeenOpened(showSettings);
  const shouldRenderNotificationsInbox = useHasBeenOpened(showNotificationsInbox);

  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ));

  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [formEndTime, setFormEndTime] = useState('');
  const [formPriority, setFormPriority] = useState<Priority>('medium');
  const [formCategory, setFormCategory] = useState('Geral');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formSuppressHolidayNotifications, setFormSuppressHolidayNotifications] = useState(false);
  const [formOverdueReminderIntensity, setFormOverdueReminderIntensity] = useState<TaskOverdueReminderIntensity>('normal');
  const [formAlarmEnabled, setFormAlarmEnabled] = useState(false);
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
  const shouldRenderTaskDetails = useHasBeenOpened(showTaskDetails);
  const shouldRenderDashboardMetric = useHasBeenOpened(Boolean(dashboardMetricDialog));
  const [taskDetailsReturnMetric, setTaskDetailsReturnMetric] = useState<DashboardMetricKey | null>(null);
  const [pendingNotificationTaskId, setPendingNotificationTaskId] = useState<string | null>(null);
  const [deletingTaskIds, setDeletingTaskIds] = useState<Set<string>>(new Set());
  const [togglingTaskIds, setTogglingTaskIds] = useState<Set<string>>(new Set());
  const [reschedulingTaskIds, setReschedulingTaskIds] = useState<Set<string>>(new Set());
  const [syncingCalendarTaskIds, setSyncingCalendarTaskIds] = useState<Set<string>>(new Set());
  const [promotingDraftIds, setPromotingDraftIds] = useState<Set<string>>(new Set());
  const [togglingActiveTaskIds, setTogglingActiveTaskIds] = useState<Set<string>>(new Set());
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
  const [activeAlarm, setActiveAlarm] = useState<ActiveAlarm | null>(null);
  const [notificationClock, setNotificationClock] = useState(() => Date.now());

  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [notePriority, setNotePriority] = useState<Priority>('medium');
  const [noteCategory, setNoteCategory] = useState('Geral');
  const [noteTags, setNoteTags] = useState<string[]>([]);
  const [noteMode, setNoteMode] = useState<NoteMode>('temporary');
  const [noteExpiresAt, setNoteExpiresAt] = useState('');
  const [isRestoringNote, setIsRestoringNote] = useState(false);
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
  const dueNotificationFallbackInFlightRef = useRef(false);
  const previousPendingOfflineTaskCountRef = useRef(0);
  const seenPushKeysRef = useRef<Set<string>>(new Set());
  const localNotificationDedupeRef = useRef<Set<string>>(new Set());
  const viewedOverdueMuteInFlightRef = useRef<Set<string>>(new Set());
  const alarmDismissedKeysRef = useRef<Set<string>>(new Set());
  const alarmSnoozeUntilRef = useRef<Map<string, number>>(new Map());
  const alarmAutoCloseTimerRef = useRef<number | null>(null);
  const {
    playSuccessSound,
    startAlarmSound,
    stopAlarmSound: stopAlarmTone,
  } = useAlarmSound(configSound);

  const stopAlarmSound = useCallback(() => {
    stopAlarmTone();

    if (alarmAutoCloseTimerRef.current) {
      window.clearTimeout(alarmAutoCloseTimerRef.current);
      alarmAutoCloseTimerRef.current = null;
    }
  }, [stopAlarmTone]);

  const minimumTaskDate = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const categoryOptions = useMemo(
    () => Array.from(new Set([...DEFAULT_CATEGORIES, ...categories])),
    [categories],
  );
  const tagOptions = useMemo(() => {
    const tagUsage = new Map<string, { label: string; count: number }>();

    const normalizeTagKey = (value: string) => value
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR');

    const append = (value: string, count = 0) => {
      const normalized = value.trim();
      if (!normalized) return;
      const key = normalizeTagKey(normalized);
      const current = tagUsage.get(key);

      if (current) {
        current.count += count;
        return;
      }

      tagUsage.set(key, { label: normalized, count });
    };

    tags.forEach((tag) => append(tag));
    tasks.forEach((task) => task.tags.forEach((tag) => append(tag, 1)));
    notes.forEach((note) => note.tags.forEach((tag) => append(tag, 1)));

    return Array.from(tagUsage.values())
      .sort((left, right) => (
        right.count - left.count ||
        left.label.localeCompare(right.label, 'pt-BR', { sensitivity: 'base' })
      ))
      .map((item) => item.label);
  }, [notes, tags, tasks]);
  const noTimeReminderFallbackTime = useMemo(
    () => formatMinutesAsTimeInput(configNoTimeReminderMinutes),
    [configNoTimeReminderMinutes],
  );
  const noteContextTask = useMemo(
    () => (noteContextTaskId ? tasks.find((task) => task.id === noteContextTaskId) ?? null : null),
    [noteContextTaskId, tasks],
  );

  const refreshNotificationsFromPush = useCallback((payload: unknown) => {
    const data = payload && typeof payload === 'object' && 'data' in payload
      ? (payload as { data?: Record<string, unknown> }).data
      : null;

    if (data?.kind === 'alarm' || data?.type === 'alarm') {
      const taskId = typeof data.taskId === 'string' ? data.taskId : null;
      const taskTitle = typeof data.taskTitle === 'string' ? data.taskTitle : 'Lembrete';
      const dueDate = typeof data.dueDate === 'string' ? data.dueDate : new Date().toISOString();
      const scheduleId = typeof data.scheduleId === 'string' ? data.scheduleId : undefined;
      const notificationId = typeof data.notificationId === 'string'
        ? data.notificationId
        : typeof data.id === 'string'
          ? data.id
          : undefined;
      const dedupeKey = typeof data.dedupeKey === 'string' ? data.dedupeKey : undefined;
      if (taskId) {
        const alarmKey = buildAlarmInstanceKey({ scheduleId, dedupeKey, taskId, dueDate });
        if (seenPushKeysRef.current.has(alarmKey) || alarmDismissedKeysRef.current.has(alarmKey)) {
          return;
        }
        seenPushKeysRef.current.add(alarmKey);
        setActiveAlarm({
          scheduleId,
          notificationId,
          dedupeKey,
          taskId,
          taskTitle,
          dueDate,
          startedAt: Date.now(),
        });
        if (auth.token) {
          void refreshNotifications(auth.token).catch(() => {
            // best effort sync after an alarm push arrives
          });
        }
        return;
      }
    }

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
    disablePushSubscription,
  } = usePushNotifications({
    token: isResetPasswordRoute ? null : auth.token,
    enabled: desktopNotificationsEnabled,
    pushPublicKey,
    notificationPermission: notifPerm,
    onPushMessage: refreshNotificationsFromPush,
  });

  useEffect(() => {
    alarmDismissedKeysRef.current = new Set(readDismissedAlarmKeys());
    localNotificationDedupeRef.current = new Set(readStringListFromLocalStorage(LOCAL_NOTIFICATION_DEDUPE_STORAGE_KEY));
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const handleChange = (event: MediaQueryListEvent) => setIsMobileViewport(event.matches);

    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const syncOnlineState = () => {
      const nextOnlineState = navigator.onLine;
      setIsOnline(nextOnlineState);
      setNotificationClock(Date.now());

      if (nextOnlineState) {
        localNotificationDedupeRef.current.clear();
      }
    };

    syncOnlineState();
    window.addEventListener('online', syncOnlineState);
    window.addEventListener('offline', syncOnlineState);

    return () => {
      window.removeEventListener('online', syncOnlineState);
      window.removeEventListener('offline', syncOnlineState);
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNotificationClock(Date.now());
    }, 15000);

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

  useEffect(() => {
    if (!auth.token) return undefined;

    const intervalId = window.setInterval(() => {
      void refreshNotes(auth.token)
        .then(() => refreshNotifications(auth.token))
        .catch(() => {
          // keep current notes/notifications when the background sync fails
        });
    }, 60000);

    return () => window.clearInterval(intervalId);
  }, [auth.token, refreshNotes, refreshNotifications]);

  useEffect(() => {
    if (!auth.token || !notificationsEnabled) return undefined;

    const runFallback = () => {
      if (dueNotificationFallbackInFlightRef.current) return;
      dueNotificationFallbackInFlightRef.current = true;

      void processDueNotifications(auth.token)
        .catch(() => {
          // keep local state as-is when the authenticated due-notification fallback fails
        })
        .finally(() => {
          dueNotificationFallbackInFlightRef.current = false;
        });
    };

    runFallback();
    const intervalId = window.setInterval(runFallback, 30000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') runFallback();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [auth.token, notificationsEnabled, processDueNotifications]);

  useEffect(() => () => {
    if (profileCloseTimerRef.current) {
      window.clearTimeout(profileCloseTimerRef.current);
    }
    stopAlarmSound();
  }, []);

  useEffect(() => {
    if (serverNotificationsEnabled === null) return;

    if (notificationPreferenceHydratedRef.current) return;

    notificationPreferenceHydratedRef.current = true;
    saveConfig({ notifications: serverNotificationsEnabled });
  }, [saveConfig, serverNotificationsEnabled]);

  useEffect(() => {
    if (!auth.token) {
      seenNotificationIdsRef.current.clear();
      previewedNotificationIdsRef.current.clear();
      welcomedUserIdRef.current = null;
      notificationPreferenceHydratedRef.current = false;
      notificationsOverrideRef.current = null;
      seenPushKeysRef.current.clear();
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
    const previousCount = previousPendingOfflineTaskCountRef.current;
    previousPendingOfflineTaskCountRef.current = pendingOfflineTaskCount;

    if (previousCount > 0 && pendingOfflineTaskCount === 0 && auth.token) {
      triggerToastOnly('Lembretes sincronizados', 'Tudo que foi criado offline já está salvo na sua conta.');
    }
  }, [auth.token, pendingOfflineTaskCount, triggerToastOnly]);

  useEffect(() => {
    if (!auth.token || !auth.currentUser || welcomedUserIdRef.current === auth.currentUser.id) return;

    const welcomedUser = auth.currentUser;
    welcomedUserIdRef.current = welcomedUser.id;
    void createNotification({
      title: 'Bem-vindo!',
      message: `Olá, ${welcomedUser.name}!`,
      tone: 'success',
      target: { type: 'notifications' },
      dedupeKey: `user:${welcomedUser.id}:welcome:${format(new Date(), 'yyyy-MM-dd')}`,
    }).then((result) => {
      if (!result.created) return;
      seenNotificationIdsRef.current.add(result.notification.id);
      triggerToastNotification('Bem-vindo!', `Olá, ${welcomedUser.name}!`);
    }).catch(() => {
      triggerToastNotification('Bem-vindo!', `Olá, ${welcomedUser.name}!`);
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
    const onUnauthorized = (event: Event) => {
      if (!auth.token) return;

      const failedToken = event instanceof CustomEvent &&
        typeof event.detail?.token === 'string'
        ? event.detail.token
        : null;
      if (failedToken && failedToken !== auth.token) return;

      triggerToastOnly('Sessão encerrada', 'Sua sessão expirou. Faça login novamente.');
      void auth.logout();
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
  }, [auth.logout, auth.token, triggerToastOnly]);

  const handleDeleteCategory = useCallback(async (name: string) => {
    await deleteCategory(name);
    await refreshNotes();
  }, [deleteCategory, refreshNotes]);

  const handleDeleteTag = useCallback(async (name: string) => {
    await deleteTag(name);
    await refreshNotes();
  }, [deleteTag, refreshNotes]);

  useEffect(() => {
    if (!activeAlarm) return;

    const alarmSnapshot = activeAlarm;
    const alarmKey = buildAlarmInstanceKey(alarmSnapshot);
    startAlarmSound();

    if (alarmAutoCloseTimerRef.current) {
      window.clearTimeout(alarmAutoCloseTimerRef.current);
    }

    alarmAutoCloseTimerRef.current = window.setTimeout(() => {
      alarmDismissedKeysRef.current.add(alarmKey);
      rememberDismissedAlarmKey(alarmKey);
      stopAlarmSound();
      setActiveAlarm((current) => (current === alarmSnapshot ? null : current));
    }, ALARM_RING_DURATION_MS);

    return () => {
      if (alarmAutoCloseTimerRef.current) {
        window.clearTimeout(alarmAutoCloseTimerRef.current);
        alarmAutoCloseTimerRef.current = null;
      }
      stopAlarmTone();
    };
  }, [activeAlarm, startAlarmSound, stopAlarmSound, stopAlarmTone]);

  useEffect(() => {
    if (!activeAlarm?.taskId) return;

    const currentTask = tasks.find((task) => task.id === activeAlarm.taskId);
    if (!currentTask || currentTask.status === 'completed' || currentTask.status === 'cancelled' || currentTask.status === 'inactive') {
      stopAlarmSound();
      setActiveAlarm(null);
    }
  }, [activeAlarm?.taskId, stopAlarmSound, tasks]);

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

  const emitLocalOfflineNotification = useCallback((
    title: string,
    message: string,
    _tone: NotificationTone = 'info',
    options?: LocalDesktopNotificationOptions,
  ) => {
    const notificationsAllowed = notificationsOverrideRef.current ?? notificationsEnabled;
    if (!notificationsAllowed) return;

    if (options?.dedupeKey) {
      const localDedupeKey = `offline:${options.dedupeKey}`;
      if (localNotificationDedupeRef.current.has(localDedupeKey)) return;
      localNotificationDedupeRef.current.add(localDedupeKey);
      rememberStringInLocalStorage(LOCAL_NOTIFICATION_DEDUPE_STORAGE_KEY, localDedupeKey);
    }

    if (!options?.skipToast) {
      triggerToastNotification(title, message);
    }

    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) {
      return;
    }

    const taskId = options?.target?.type === 'task' ? options.target.taskId : undefined;
    const notificationOptions: NotificationOptions & { actions?: LocalNotificationAction[] } = {
      body: message,
      icon: '/icon.png',
      badge: '/icon.png',
      tag: options?.dedupeKey ? `offline:${options.dedupeKey}` : `offline:${title}:${message}`,
      actions: options?.actions,
      data: {
        path: buildNotificationNavigationPath(options?.target),
        target: options?.target ?? { type: 'notifications' },
        kind: options?.kind,
        type: options?.kind,
        taskId,
        dedupeKey: options?.dedupeKey,
        offline: true,
      },
    };

    void (async () => {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, notificationOptions);
        return;
      }

      new Notification(title, notificationOptions);
    })().catch(() => {
      // Local offline notification is best effort; the in-app toast already ran.
    });
  }, [notificationsEnabled, triggerToastNotification]);

  const resetTaskForm = useCallback(() => {
    setFormTitle('');
    setFormDesc('');
    setFormDate('');
    setFormTime('');
    setFormEndTime('');
    setFormPriority('medium');
    setFormCategory('Geral');
    setFormTags([]);
    setFormSuppressHolidayNotifications(false);
    setFormOverdueReminderIntensity('normal');
    setFormAlarmEnabled(false);
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
    setNoteExpiresAt(buildDefaultNoteExpiry());
    setIsRestoringNote(false);
    setNoteTaskId(null);
    setNoteContextTaskId(null);
    setEditingNote(null);
    setShowNoteDrawer(false);
  }, []);

  const markOverdueTaskViewed = useCallback((task: Task) => {
    if (!hasTaskDueDate(task)) return;
    if (task.status === 'completed' || task.status === 'draft' || task.status === 'inactive') return;
    if (getDerivedTaskStatus(task) !== 'overdue') return;
    if (viewedOverdueMuteInFlightRef.current.has(task.id)) return;

    const now = new Date();
    const currentMutedUntil = task.mutedUntil ? new Date(task.mutedUntil) : null;
    if (currentMutedUntil && !Number.isNaN(currentMutedUntil.getTime()) && currentMutedUntil > now) {
      return;
    }

    const mutedUntil = addMinutes(now, OVERDUE_VIEWED_MUTE_MINUTES).toISOString();
    viewedOverdueMuteInFlightRef.current.add(task.id);

    void updateTask(task.id, { mutedUntil }).then((updated) => {
      setSelectedTask((current) => (current?.id === task.id ? updated : current));
      triggerToastOnly(
        'Lembrete visto',
        `Avisos de atraso reduzidos por ${OVERDUE_VIEWED_MUTE_MINUTES} minutos.`,
      );
    }).catch(() => {
      // The detail still opens; reducing the frequency is best effort.
    }).finally(() => {
      viewedOverdueMuteInFlightRef.current.delete(task.id);
    });
  }, [triggerToastOnly, updateTask]);

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
    const relatedTaskStatus = getDerivedTaskStatus(relatedTask);
    setTasksPageView(
      relatedTask.status === 'draft'
        ? 'drafts'
        : relatedTaskStatus === 'completed' && configShowCompleted
          ? 'completed'
          : 'agenda',
    );
    setSelectedTask(relatedTask);
    setShowTaskDetails(true);
    markOverdueTaskViewed(relatedTask);
    setPendingNotificationTaskId(null);
  }, [configShowCompleted, markOverdueTaskViewed, pendingNotificationTaskId, tasks]);

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
    setFormEndTime('');
    setFormPriority(template.priority);
    setFormCategory(template.category);
    setFormTags([]);
    setFormSuppressHolidayNotifications(false);
    setFormOverdueReminderIntensity('normal');
    setFormAlarmEnabled(false);
    setShowTaskDrawer(true);
  }, [resetTaskForm]);

  const openEditTask = useCallback((task: Task) => {
    setShowNotificationsInbox(false);
    const dueDateForm = parseDueDateToForm(task.dueDate);
    const endDateForm = task.endDate ? parseDueDateToForm(task.endDate) : { date: '', time: '' };
    setFormTitle(task.title);
    setFormDesc(task.description);
    setFormDate(dueDateForm.date);
    setFormTime(dueDateForm.time);
    setFormEndTime(endDateForm.time);
    setFormPriority(task.priority);
    setFormCategory(task.category || 'Geral');
    setFormTags(task.tags ?? []);
    setFormSuppressHolidayNotifications(task.suppressHolidayNotifications ?? false);
    setFormOverdueReminderIntensity(task.overdueReminderIntensity ?? 'normal');
    setFormAlarmEnabled(task.alarmEnabled ?? false);
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
    const endDateForm = task.endDate ? parseDueDateToForm(task.endDate) : { date: '', time: '' };
    setFormTitle(`${task.title} (cópia)`);
    setFormDesc(task.description);
    setFormDate(dueDateForm.date);
    setFormTime(dueDateForm.time);
    setFormEndTime(endDateForm.time);
    setFormPriority(task.priority);
    setFormCategory(task.category || 'Geral');
    setFormTags(task.tags ?? []);
    setFormSuppressHolidayNotifications(task.suppressHolidayNotifications ?? false);
    setFormOverdueReminderIntensity(task.overdueReminderIntensity ?? 'normal');
    setFormAlarmEnabled(task.alarmEnabled ?? false);
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
    markOverdueTaskViewed(task);
  }, [markOverdueTaskViewed]);

  const openEditNote = useCallback((note: Note, options?: { taskContextId?: string | null }) => {
    setShowNotificationsInbox(false);
    setEditingNote(note);
    setNoteTitle(note.title);
    setNoteContent(note.content);
    setNotePriority(note.priority);
    setNoteCategory(note.category || 'Geral');
    setNoteTags(note.tags ?? []);
    setNoteMode(note.mode);
    setNoteExpiresAt(formatDateTimeLocalValue(note.expiresAt));
    setIsRestoringNote(false);
    setNoteTaskId(note.taskId ?? null);
    setNoteContextTaskId(options?.taskContextId ?? null);
    setShowNoteDrawer(true);
  }, []);

  const openRestoreNote = useCallback((note: Note) => {
    setShowNotificationsInbox(false);
    setEditingNote(note);
    setNoteTitle(note.title);
    setNoteContent(note.content);
    setNotePriority(note.priority);
    setNoteCategory(note.category || 'Geral');
    setNoteTags(note.tags ?? []);
    setNoteMode(note.mode);
    setNoteExpiresAt(note.mode === 'temporary' ? '' : formatDateTimeLocalValue(note.expiresAt));
    setNoteTaskId(note.taskId ?? null);
    setNoteContextTaskId(null);
    setIsRestoringNote(true);
    setShowNoteDrawer(true);
  }, []);

  const openTaskDetailsFromMetric = useCallback((task: Task, metric: DashboardMetricKey) => {
    setShowNotificationsInbox(false);
    setDashboardMetricDialog(null);
    setTaskDetailsReturnMetric(metric);
    setSelectedTask(task);
    setShowTaskDetails(true);
    markOverdueTaskViewed(task);
  }, [markOverdueTaskViewed]);

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

  const downloadCalendarExport = useCallback(async () => {
    if (!auth.token) {
      emitNotification('Faça login primeiro', 'Entre na sua conta para exportar a agenda.', 'warning');
      throw new Error('Não autenticado');
    }

    const response = await fetch('/api/tasks/calendar.ics', {
      headers: buildHeaders(auth.token),
    });

    if (!response.ok) {
      emitNotification('Exportação indisponível', 'Não foi possível gerar o arquivo .ics agora.', 'error');
      throw new Error('Falha ao exportar calendário');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'lembreto.ics';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      URL.revokeObjectURL(url);
    }

    emitNotification('Agenda exportada', 'O arquivo .ics foi gerado com seus lembretes pendentes.', 'success');
  }, [auth.token, emitNotification]);

  const copyCalendarFeed = useCallback(async () => {
    if (!auth.token) {
      emitNotification('Faça login primeiro', 'Entre na sua conta para copiar o feed da agenda.', 'warning');
      throw new Error('Não autenticado');
    }

    const feed = await apiGet<CalendarFeedResponse>('/api/tasks/calendar/feed', auth.token);
    const feedUrl = new URL(feed.feedPath, window.location.origin).toString();

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(feedUrl);
    } else {
      fallbackCopyText(feedUrl);
    }

    emitNotification('Feed copiado', 'Use o link para assinar os lembretes no Google Calendar ou Outlook.', 'success');
  }, [auth.token, emitNotification]);

  const rotateCalendarFeed = useCallback(async () => {
    if (!auth.token) {
      emitNotification('Faça login primeiro', 'Entre na sua conta para rotacionar o feed da agenda.', 'warning');
      throw new Error('Não autenticado');
    }

    const feed = await apiPost<CalendarFeedResponse>('/api/tasks/calendar/feed', {}, auth.token);
    const feedUrl = new URL(feed.feedPath, window.location.origin).toString();

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(feedUrl);
    } else {
      fallbackCopyText(feedUrl);
    }

    emitNotification('Feed rotacionado', 'Links anteriores foram revogados e o novo feed foi copiado.', 'success');
  }, [auth.token, emitNotification]);

  const handleConnectCalendar = useCallback((provider: 'google' | 'outlook') => {
    try {
      connectCalendar(provider);
    } catch {
      emitNotification('Faça login primeiro', 'Entre na sua conta para conectar um calendário externo.', 'warning');
    }
  }, [connectCalendar, emitNotification]);

  const handleDisconnectCalendar = useCallback(async (provider: 'google' | 'outlook') => {
    await disconnectCalendar(provider);
    emitNotification(
      'Calendário desconectado',
      provider === 'google' ? 'Google Calendar foi desconectado.' : 'Outlook Calendar foi desconectado.',
      'info',
    );
  }, [disconnectCalendar, emitNotification]);

  const handleToggleCalendarSync = useCallback(async (provider: 'google' | 'outlook', syncEnabled: boolean) => {
    await updateCalendarSync(provider, syncEnabled);
    emitNotification(
      syncEnabled ? 'Envio automático ativado' : 'Envio automático pausado',
      syncEnabled
        ? 'Novos lembretes com prazo serão enviados ao calendário externo.'
        : 'Os lembretes continuarão salvos localmente sem envio automático.',
      'success',
    );
  }, [emitNotification, updateCalendarSync]);

  const handleSyncAllCalendar = useCallback(async (provider: 'google' | 'outlook') => {
    const providerName = provider === 'google' ? 'Google Calendar' : 'Outlook Calendar';

    try {
      const result = await syncAllNow(provider);
      void refreshTasks().catch(() => undefined);
      void refreshCalendarIntegrations().catch(() => undefined);

      const summary = [
        `${result.pushed} lembrete${result.pushed === 1 ? '' : 's'} enviado${result.pushed === 1 ? '' : 's'}`,
        `${result.imported} evento${result.imported === 1 ? '' : 's'} importado${result.imported === 1 ? '' : 's'}`,
        `${result.deduplicated} duplicata${result.deduplicated === 1 ? '' : 's'} resolvida${result.deduplicated === 1 ? '' : 's'}`,
      ];
      const title = result.failed > 0 ? 'Sincronização concluída com avisos' : 'Calendário sincronizado';
      const message = `${providerName}: ${summary.join(' e ')}.${result.failed > 0 ? ` ${result.failed} falha${result.failed === 1 ? '' : 's'}.` : ''}`;
      const tone = result.failed > 0 ? 'warning' : 'success';

      emitNotification(title, message, tone, { skipToast: true });
      triggerToastOnly(title, message);

      return result;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : `Não foi possível sincronizar ${providerName} agora.`;
      emitNotification('Falha ao sincronizar calendário', message, 'error', { skipToast: true });
      triggerToastOnly('Falha ao sincronizar calendário', message);
      throw error;
    }
  }, [emitNotification, refreshCalendarIntegrations, refreshTasks, syncAllNow, triggerToastOnly]);

  const handleSyncTaskCalendar = useCallback(async (task: Task) => {
    if (syncingCalendarTaskIds.has(task.id)) return;

    try {
      setSyncingCalendarTaskIds((prev) => new Set(prev).add(task.id));
      await syncTaskNow(task.id);
      await refreshTasks();
      emitNotification(
        'Calendário atualizado',
        `"${task.title}" foi sincronizado com o calendário conectado.`,
        'success',
        { target: { type: 'task', taskId: task.id } },
      );
    } catch (error) {
      emitNotification(
        'Falha ao sincronizar',
        error instanceof Error ? error.message : 'Não foi possível enviar este lembrete ao calendário.',
        'warning',
        { target: { type: 'task', taskId: task.id } },
      );
    } finally {
      setSyncingCalendarTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }, [emitNotification, refreshTasks, syncTaskNow, syncingCalendarTaskIds]);

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

  const isNotificationActionBusy = useCallback((notification: AppNotification) => {
    return notification.target?.type === 'task'
      ? reschedulingTaskIds.has(notification.target.taskId)
      : false;
  }, [reschedulingTaskIds]);

  const handleSnoozeOverdueNotification = useCallback(async (
    notification: AppNotification,
    preset: OverdueNotificationSnoozePreset,
  ) => {
    if (notification.kind !== 'overdue_reminder' || notification.target?.type !== 'task') return;

    const taskId = notification.target.taskId;
    if (reschedulingTaskIds.has(taskId)) return;

    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      setActiveTab('tasks');
      setPendingNotificationTaskId(taskId);
      triggerToastOnly('Abrindo lembrete', 'Não encontrei o lembrete na lista atual; vou abrir a agenda para sincronizar.');
      return;
    }

    try {
      setReschedulingTaskIds((prev) => new Set(prev).add(taskId));
      const updated = await updateTask(taskId, buildOverdueNotificationSnoozePayload(task, preset));

      setSelectedTask((current) => (current?.id === taskId ? updated : current));
      if (!notification.read) {
        void markNotificationRead(notification.id, true).catch(() => {
          // the reschedule is the important part; read state can sync later
        });
      }
      triggerToastOnly(
        'Lembrete adiado',
        `"${task.title}" será lembrado ${getOverdueNotificationSnoozeLabel(preset)}.`,
      );
    } catch (error) {
      emitNotification(
        'Não foi possível adiar',
        error instanceof Error ? error.message : 'Tente novamente em instantes.',
        'error',
      );
    } finally {
      setReschedulingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }, [
    emitNotification,
    markNotificationRead,
    reschedulingTaskIds,
    tasks,
    triggerToastOnly,
    updateTask,
  ]);

  const taskDueDateError = useMemo(() => {
    if (isWorkCategory(formCategory) && (!formDate || !formTime)) {
      return 'Horário inicial e horário final são obrigatórios para categoria Trabalho.';
    }

    if (formTime && !formDate) {
      return 'Escolha uma data para usar o horário inicial.';
    }

    if (!formDate || !formTime) return '';

    const dueDateValue = new Date(buildDueDateFromForm(formDate, formTime));
    if (isPast(dueDateValue) && !isToday(dueDateValue)) {
      return 'Escolha uma data de hoje em diante.';
    }

    return '';
  }, [formCategory, formDate, formTime]);

  const taskEndTimeError = useMemo(() => {
    if (isWorkCategory(formCategory) && (!formDate || !formTime)) {
      return 'Horário inicial e horário final são obrigatórios para categoria Trabalho.';
    }

    if (formEndTime && (!formDate || !formTime)) {
      return 'Defina o horário inicial antes do horário final.';
    }

    if (!formDate || !formTime) return '';

    const requiresEndTime = isWorkCategory(formCategory);
    if (requiresEndTime && !formEndTime) {
      return 'Horário final obrigatório para categoria Trabalho.';
    }

    if (!formEndTime) return '';

    const dueDateValue = new Date(buildDueDateFromForm(formDate, formTime));
    const endDateValue = new Date(buildDueDateFromForm(formDate, formEndTime));

    if (endDateValue.getTime() <= dueDateValue.getTime()) {
      return 'O horário final precisa ser depois do horário inicial.';
    }

    return '';
  }, [formCategory, formDate, formEndTime, formTime]);

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
    return countDateKeyMatches(recurringDates, holidayDateKeys);
  }, [formRecurrenceEnabled, formSuppressHolidayNotifications, holidayDateKeys, recurringDates]);

  const recurrenceError = useMemo(() => getRecurrenceValidationError({
    isEditing: Boolean(editingTask),
    enabled: formRecurrenceEnabled,
    startDateValue: formDate,
    endDateValue: formRecurrenceUntil,
    occurrenceCount: recurringDates.length,
  }), [editingTask, formDate, formRecurrenceEnabled, formRecurrenceUntil, recurringDates.length]);

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
        triggerToastOnly('Central ativada', 'Novos avisos voltarão a aparecer na central e na interface.');
      } else {
        triggerToastOnly('Central desativada', 'A central deixará de registrar novos avisos até você reativar.');
      }
    } catch {
      notificationsOverrideRef.current = !nextValue;
      saveConfig({ notifications: !nextValue });
      triggerToastOnly('Não foi possível salvar', 'A preferência de notificações não foi atualizada.');
    }
  }, [notificationsEnabled, saveConfig, triggerToastOnly, updateNotificationsEnabled]);

  const handleToggleDesktopNotifications = useCallback(async () => {
    if (desktopNotificationsEnabled) {
      try {
        await disablePushSubscription();
        saveConfig({ desktopNotifications: false });
        triggerToastOnly(
          'Notificações do Windows desativadas',
          'Este navegador deixou de receber avisos fora da aba.',
        );
      } catch (error) {
        triggerToastOnly(
          'Não foi possível desativar',
          error instanceof Error
            ? error.message
            : 'Não foi possível desativar as notificações do Windows neste navegador.',
        );
      }
      return;
    }

    if (!auth.token) {
      triggerToastOnly('Faça login primeiro', 'Entre na sua conta para conectar este navegador às notificações do Windows.');
      return;
    }

    if (!pushConfigured || !pushPublicKey) {
      triggerToastOnly('Push indisponível', 'As chaves de notificação ainda não foram configuradas neste ambiente.');
      return;
    }

    try {
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

      saveConfig({ desktopNotifications: true });
      await syncPushSubscription(true);
      triggerToastOnly(
        'Notificações do Windows ativadas',
        'Este navegador foi conectado e passará a receber seus lembretes fora da aba.',
      );
    } catch (error) {
      saveConfig({ desktopNotifications: false });
      await disablePushSubscription().catch(() => {
        // best effort cleanup after a failed activation
      });
      triggerToastOnly(
        'Não foi possível ativar',
        error instanceof Error
          ? error.message
          : 'Não foi possível ativar as notificações do Windows neste navegador.',
      );
    }
  }, [
    auth.token,
    desktopNotificationsEnabled,
    disablePushSubscription,
    pushConfigured,
    pushPublicKey,
    requestPermission,
    saveConfig,
    syncPushSubscription,
    triggerToastOnly,
  ]);

  const handleSubmitTask = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formTitle.trim() || isTaskSubmitting) return;

    if (taskDueDateError) {
      emitNotification('Prazo inválido', taskDueDateError, 'warning');
      return;
    }

    if (taskEndTimeError) {
      emitNotification('Horário final inválido', taskEndTimeError, 'warning');
      return;
    }

    if (recurrenceError) {
      emitNotification('Repetição inválida', recurrenceError, 'warning');
      return;
    }

    const hasStart = Boolean(formDate && formTime);

    if (formRecurrenceEnabled && !hasStart) {
      emitNotification('Repetição inválida', 'Defina data e horário inicial para criar lembretes recorrentes.', 'warning');
      return;
    }

    if (formAlarmEnabled && !hasStart) {
      emitNotification('Horário obrigatório', 'Informe o horário inicial para ativar o alarme sonoro.', 'warning');
      return;
    }

    const dueDate = hasStart ? buildDueDateFromForm(formDate, formTime) : null;
    const endDate = hasStart && formEndTime ? buildDueDateFromForm(formDate, formEndTime) : null;

    const payload = {
      title: formTitle,
      description: formDesc,
      dueDate,
      endDate,
      priority: formPriority,
      category: formCategory,
      tags: formTags,
      suppressHolidayNotifications: formSuppressHolidayNotifications,
      overdueReminderIntensity: formOverdueReminderIntensity,
      alarmEnabled: hasStart && formAlarmEnabled,
      noTimeReminderMinutes: configNoTimeReminderMinutes,
      ...(editingTask?.status === 'draft' ? { status: 'pending' as const } : {}),
    };

      try {
        setIsTaskSubmitting(true);

        if (editingTask) {
          const updated = await updateTask(editingTask.id, payload);
          emitNotification(
            updated.externalCalendarSyncStatus === 'failed' ? 'Lembrete salvo com aviso' : 'Lembrete atualizado!',
            updated.externalCalendarSyncStatus === 'failed'
              ? (updated.externalCalendarLastError ?? 'O lembrete foi salvo, mas a sincronização do calendário falhou.')
              : 'As informações do lembrete foram salvas.',
            updated.externalCalendarSyncStatus === 'failed' ? 'warning' : 'success',
            {
            target: { type: 'task', taskId: editingTask.id },
            },
          );
        } else {
          if (formRecurrenceEnabled && recurringDates.length > 1) {
            let offlineCount = 0;
            let calendarFailedCount = 0;
            for (const dateValue of recurringDates) {
              const created = await createTask({
                ...payload,
                dueDate: buildDueDateFromForm(dateValue, formTime),
                endDate: formEndTime ? buildDueDateFromForm(dateValue, formEndTime) : null,
              });
              if (created.syncStatus === 'pending') offlineCount += 1;
              if (created.externalCalendarSyncStatus === 'failed') calendarFailedCount += 1;
            }

            emitNotification(
              offlineCount > 0
                ? 'Lembretes salvos offline'
                : calendarFailedCount > 0
                  ? 'Lembretes criados com aviso'
                  : 'Lembretes criados!',
              offlineCount > 0
                ? `${offlineCount} lembrete${offlineCount === 1 ? '' : 's'} ficar${offlineCount === 1 ? 'á' : 'ão'} na fila e sincronizar${offlineCount === 1 ? 'á' : 'ão'} quando a conexão voltar.`
                : calendarFailedCount > 0
                  ? `${calendarFailedCount} lembrete${calendarFailedCount === 1 ? '' : 's'} foi salvo, mas não sincronizou com o calendário externo.`
                : `${recurringDates.length} lembretes foram adicionados até ${formRecurrenceUntil}.`,
              offlineCount > 0 ? 'info' : calendarFailedCount > 0 ? 'warning' : 'success',
            );
          } else {
            const created = await createTask(payload);
            if (created.syncStatus === 'pending') {
              emitNotification(
                'Lembrete salvo offline',
                `"${created.title}" será sincronizado quando a conexão voltar.`,
                'info',
                { toastOnly: true },
              );
            } else if (created.externalCalendarSyncStatus === 'failed') {
              emitNotification(
                'Lembrete salvo com aviso',
                created.externalCalendarLastError ?? 'O lembrete foi salvo, mas a sincronização do calendário falhou.',
                'warning',
                { target: { type: 'task', taskId: created.id } },
              );
            } else {
              emitNotification('Lembrete criado!', `"${created.title}" foi adicionado.`, 'success', {
                target: { type: 'task', taskId: created.id },
              });
            }
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
    formEndTime,
    formAlarmEnabled,
    configNoTimeReminderMinutes,
    formPriority,
    formTime,
    formTitle,
    formTags,
    noTimeReminderFallbackTime,
    formOverdueReminderIntensity,
    formSuppressHolidayNotifications,
    isTaskSubmitting,
    resetTaskForm,
    recurringDates,
    recurrenceError,
    formRecurrenceEnabled,
    formRecurrenceUntil,
    taskDueDateError,
    taskEndTimeError,
    updateTask,
  ]);

  const handleSaveTaskDraft = useCallback(async () => {
    if (!formTitle.trim() || isTaskSubmitting) {
      emitNotification('Rascunho incompleto', 'Informe pelo menos o título para salvar o rascunho.', 'warning');
      return;
    }

    if (taskDueDateError) {
      emitNotification('Prazo inválido', taskDueDateError, 'warning');
      return;
    }

    if (taskEndTimeError) {
      emitNotification('Horário final inválido', taskEndTimeError, 'warning');
      return;
    }

    const hasStart = Boolean(formDate && formTime);

    if (formAlarmEnabled && !hasStart) {
      emitNotification('Horário obrigatório', 'Informe o horário inicial para salvar o rascunho com alarme.', 'warning');
      return;
    }

    const dueDate = hasStart ? buildDueDateFromForm(formDate, formTime) : null;
    const endDate = hasStart && formEndTime ? buildDueDateFromForm(formDate, formEndTime) : null;

    if (dueDate && endDate && Date.parse(endDate) <= Date.parse(dueDate)) {
      emitNotification('Horário final inválido', 'O horário final precisa ser depois do horário inicial.', 'warning');
      return;
    }

    const payload = {
      title: formTitle,
      description: formDesc,
      dueDate,
      endDate,
      priority: formPriority,
      category: formCategory,
      tags: formTags,
      suppressHolidayNotifications: formSuppressHolidayNotifications,
      overdueReminderIntensity: formOverdueReminderIntensity,
      alarmEnabled: hasStart && formAlarmEnabled,
      noTimeReminderMinutes: configNoTimeReminderMinutes,
      status: 'draft' as const,
    };

    try {
      setIsTaskSubmitting(true);

      const saved = editingTask
        ? await updateTask(editingTask.id, payload)
        : await createTask(payload);

      emitNotification('Rascunho salvo', `"${saved.title}" ficou disponível em Meus lembretes > Rascunhos.`, 'success', {
        target: { type: 'task', taskId: saved.id },
      });
      resetTaskForm();
      setTasksPageView('drafts');
      setActiveTab('tasks');
    } catch (error) {
      emitNotification('Erro', error instanceof Error ? error.message : 'Falha ao salvar o rascunho.', 'error');
    } finally {
      setIsTaskSubmitting(false);
    }
  }, [
    createTask,
    editingTask,
    emitNotification,
    formCategory,
    formDate,
    formDesc,
    formEndTime,
    formAlarmEnabled,
    configNoTimeReminderMinutes,
    formPriority,
    formOverdueReminderIntensity,
    formSuppressHolidayNotifications,
    formTags,
    formTime,
    formTitle,
    isTaskSubmitting,
    noTimeReminderFallbackTime,
    resetTaskForm,
    taskDueDateError,
    taskEndTimeError,
    updateTask,
  ]);

  const handleSubmitNote = useCallback(async () => {
    if (!noteTitle.trim() || isNoteSubmitting) return;
    const expiresAt = noteMode === 'temporary' ? buildIsoFromDateTimeLocal(noteExpiresAt) : null;

    if (noteMode === 'temporary' && !expiresAt) {
      emitNotification('Validade obrigatória', 'Informe até quando a nota temporária deve permanecer no sistema.', 'warning');
      return;
    }

    const payload = {
      title: noteTitle,
      content: noteContent,
      priority: notePriority,
      category: noteCategory,
      tags: noteTags,
      mode: noteMode,
      expiresAt,
      taskId: noteContextTaskId ?? noteTaskId,
      ...(isRestoringNote ? { restore: true } : {}),
    };

    try {
      setIsNoteSubmitting(true);

      if (editingNote) {
        await updateNote(editingNote.id, payload);
        emitNotification(isRestoringNote ? 'Nota reativada' : 'Nota atualizada', isRestoringNote ? 'A nota voltou para o seu caderno.' : 'As informações da nota foram salvas.', 'success', {
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
    noteExpiresAt,
    noteMode,
    notePriority,
    noteTags,
    noteTaskId,
    noteTitle,
    resetNoteForm,
    isRestoringNote,
    updateNote,
  ]);

  const handleToggle = useCallback(async (task: Task) => {
    if (togglingTaskIds.has(task.id)) return;

    try {
      setTogglingTaskIds((prev) => new Set(prev).add(task.id));
      const { task: updatedTask, newStatus } = await toggleStatus(task);

      if (newStatus === 'completed') {
        playSuccessSound();
        triggerToastOnly('Parabéns!', `"${task.title}" foi concluído.`);
        emitNotification('Parabéns!', `"${task.title}" foi concluído.`, 'success', {
          target: { type: 'task', taskId: task.id },
          skipToast: true,
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
  }, [emitNotification, playSuccessSound, toggleStatus, togglingTaskIds, triggerToastOnly]);

  const handleToggleFromDetails = useCallback(async (task: Task) => {
    const isCompleting = task.status === 'pending' || task.status === 'overdue';
    const result = await handleToggle(task);

    if (result?.newStatus === 'completed') {
      if (isCompleting) {
        setShowTaskDetails(false);
        setSelectedTask(null);
      }
      return;
    }

    if (result?.task) {
      setSelectedTask(result.task);
    }
  }, [handleToggle]);

  const handlePromoteDraft = useCallback(async (task: Task) => {
    if (task.status !== 'draft' || promotingDraftIds.has(task.id)) return;

    if (isWorkCategory(task.category) && (!task.dueDate || !task.endDate)) {
      emitNotification(
        'Horário obrigatório',
        'Edite o rascunho e informe início e fim antes de adicionar um lembrete de Trabalho.',
        'warning',
      );
      openEditTask(task);
      return;
    }

    try {
      setPromotingDraftIds((prev) => new Set(prev).add(task.id));
      const updated = await updateTask(task.id, { status: 'pending' });
      emitNotification('Lembrete adicionado', `"${updated.title}" saiu dos rascunhos e entrou nos pendentes.`, 'success', {
        target: { type: 'task', taskId: updated.id },
      });
      setTasksPageView('agenda');
    } catch (error) {
      emitNotification('Erro', error instanceof Error ? error.message : 'Não foi possível adicionar o rascunho como lembrete.', 'error');
    } finally {
      setPromotingDraftIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }, [emitNotification, openEditTask, promotingDraftIds, updateTask]);

  const handleToggleActiveTask = useCallback(async (task: Task) => {
    if (task.status === 'draft' || task.status === 'completed' || togglingActiveTaskIds.has(task.id)) return;

    const nextStatus = task.status === 'inactive' ? 'pending' : 'inactive';

    if (
      nextStatus === 'pending' &&
      isWorkCategory(task.category) &&
      (!task.dueDate || !task.endDate)
    ) {
      emitNotification(
        'Horário obrigatório',
        'Informe início e fim antes de ativar este lembrete de Trabalho.',
        'warning',
      );
      openEditTask(task);
      return;
    }

    try {
      setTogglingActiveTaskIds((prev) => new Set(prev).add(task.id));
      const updated = await updateTask(task.id, { status: nextStatus });
      const isNowActive = updated.status === 'pending';
      emitNotification(
        isNowActive ? 'Lembrete ativado' : 'Lembrete desativado',
        isNowActive
          ? `"${updated.title}" voltou a disparar alertas.`
          : `"${updated.title}" foi pausado e não disparará alertas.`,
        'success',
        { target: { type: 'task', taskId: updated.id } },
      );
    } catch (error) {
      emitNotification(
        'Erro',
        error instanceof Error ? error.message : 'Não foi possível alterar a ativação do lembrete.',
        'error',
      );
    } finally {
      setTogglingActiveTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }, [emitNotification, openEditTask, togglingActiveTaskIds, updateTask]);

  const closeActiveAlarm = useCallback(() => {
    if (activeAlarm) {
      const alarmKey = buildAlarmInstanceKey(activeAlarm);
      alarmDismissedKeysRef.current.add(alarmKey);
      rememberDismissedAlarmKey(alarmKey);
      if (activeAlarm.scheduleId && auth.token) {
        void apiPost(
          `/api/notifications/alarms/${activeAlarm.scheduleId}/dismiss`,
          {},
          auth.token,
        ).catch(() => {
          // The local dismissal still prevents repeat ringing in this session.
        });
      }
    }

    stopAlarmSound();
    setActiveAlarm(null);
  }, [activeAlarm, auth.token, stopAlarmSound]);

  const snoozeActiveAlarm = useCallback(() => {
    if (!activeAlarm) return;

    const alarmKey = buildAlarmInstanceKey(activeAlarm);
    alarmDismissedKeysRef.current.add(alarmKey);
    rememberDismissedAlarmKey(alarmKey);
    if (activeAlarm.scheduleId && auth.token) {
      void apiPost(
        `/api/notifications/alarms/${activeAlarm.scheduleId}/snooze`,
        { minutes: ALARM_SNOOZE_MINUTES },
        auth.token,
      ).catch(() => {
        alarmSnoozeUntilRef.current.set(alarmKey, Date.now() + ALARM_SNOOZE_MINUTES * 60 * 1000);
      });
    } else {
      alarmSnoozeUntilRef.current.set(alarmKey, Date.now() + ALARM_SNOOZE_MINUTES * 60 * 1000);
    }
    stopAlarmSound();
    setActiveAlarm(null);
    triggerToastOnly('Alarme adiado', `Vamos tocar novamente em ${ALARM_SNOOZE_MINUTES} minutos.`);
  }, [activeAlarm, auth.token, stopAlarmSound, triggerToastOnly]);

  const completeActiveAlarmTask = useCallback(() => {
    if (!activeAlarm) return;

    const taskId = activeAlarm.taskId;
    stopAlarmSound();
    void updateTask(taskId, { status: 'completed' }).then(() => {
      triggerToastOnly('Lembrete concluído', 'O alarme foi encerrado e o lembrete foi marcado como concluído.');
      setActiveAlarm(null);
    }).catch((error) => {
      emitNotification(
        'Erro',
        error instanceof Error ? error.message : 'Não foi possível concluir o lembrete.',
        'error',
      );
    });
  }, [activeAlarm, emitNotification, stopAlarmSound, triggerToastOnly, updateTask]);

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

  const handleDeleteFromDetails = useCallback(async (task: Task) => {
    if (deletingTaskIds.has(task.id)) return;

    setSelectedTask(task);
    if (configConfirmDelete) {
      setPendingDeleteTask({
        id: task.id,
        title: task.title,
      });
      return;
    }

    setDeletingTaskIds((prev) => new Set(prev).add(task.id));
    try {
      await deleteTask(task.id);
      emitNotification('Lembrete removido', 'O lembrete foi excluído com sucesso.', 'info', { toastOnly: true });
      setSelectedTask(null);
      setShowTaskDetails(false);
    } catch {
      emitNotification('Erro', 'Falha ao excluir o lembrete.', 'error');
    } finally {
      setDeletingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
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
      emitNotification('Nota movida para a Lixeira', 'Ela pode ser reativada por 3 dias antes da exclusão permanente.', 'info', { toastOnly: true });
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

  const derivedStatusNow = useMemo(() => new Date(notificationClock), [notificationClock]);

  const pendingTasks = useMemo(
    () => tasks.filter((task) => task.status !== 'draft' && getDerivedTaskStatus(task, derivedStatusNow) === 'pending'),
    [derivedStatusNow, tasks]
  );

  const overdueTasks = useMemo(
    () => tasks.filter((task): task is TaskWithDueDate => (
      hasTaskDueDate(task) && getDerivedTaskStatus(task, derivedStatusNow) === 'overdue'
    )),
    [derivedStatusNow, tasks]
  );

  const draftTasks = useMemo(
    () => tasks.filter((task) => task.status === 'draft'),
    [tasks]
  );

  const inactiveTasks = useMemo(
    () => tasks.filter((task) => task.status === 'inactive'),
    [tasks]
  );

  const cancelledTasks = useMemo(
    () => tasks.filter((task) => getDerivedTaskStatus(task, derivedStatusNow) === 'cancelled' && task.status !== 'inactive'),
    [derivedStatusNow, tasks]
  );

  const taskListRows = useMemo(
    () => [...overdueTasks, ...pendingTasks, ...inactiveTasks, ...cancelledTasks],
    [cancelledTasks, inactiveTasks, overdueTasks, pendingTasks]
  );

  const calendarTasks = useMemo(
    () => tasks.filter((task) => task.status !== 'draft'),
    [tasks]
  );

  const dashboardTasks = useMemo(
    () => calendarTasks.filter((task) => getDerivedTaskStatus(task, derivedStatusNow) !== 'cancelled'),
    [calendarTasks, derivedStatusNow]
  );

  const completedTasks = useMemo(
    () => tasks.filter((task) => getDerivedTaskStatus(task, derivedStatusNow) === 'completed'),
    [derivedStatusNow, tasks]
  );

  const todayTasks = useMemo(() => {
    return pendingTasks.filter((task): task is TaskWithDueDate => {
      if (!hasTaskDueDate(task)) return false;

      try {
        const dueDate = parseISO(task.dueDate);
        return isToday(dueDate) && !isPast(dueDate);
      } catch {
        return false;
      }
    });
  }, [pendingTasks]);

  const tomorrowTasks = useMemo(() => {
    return pendingTasks.filter((task): task is TaskWithDueDate => {
      if (!hasTaskDueDate(task)) return false;

      try {
        return isTomorrow(parseISO(task.dueDate));
      } catch {
        return false;
      }
    });
  }, [pendingTasks]);

  const pendingSummary = useMemo(() => ({
    todayCount: todayTasks.length,
    overdueCount: overdueTasks.length,
  }), [overdueTasks.length, todayTasks.length]);

  const timedPendingTasks = useMemo(() => {
    return pendingTasks.filter((task): task is TaskWithDueDate => (
      hasTaskDueDate(task) && Boolean(getTaskTimeLabel(task.dueDate))
    ));
  }, [pendingTasks]);

  const timedActiveTasks = useMemo(() => {
    return tasks.filter((task): task is TaskWithDueDate => (
      hasTaskDueDate(task) &&
      Boolean(getTaskTimeLabel(task.dueDate)) &&
      task.status !== 'completed' &&
      task.status !== 'draft' &&
      task.status !== 'inactive' &&
      task.status !== 'cancelled'
    ));
  }, [tasks]);

  const shouldSuppressHolidayNotification = useCallback((task: Task) => {
    if (!task.suppressHolidayNotifications) return false;
    if (!hasTaskDueDate(task)) return false;

    try {
      return holidayDateKeys.has(format(parseISO(task.dueDate), 'yyyy-MM-dd'));
    } catch {
      return false;
    }
  }, [holidayDateKeys]);

  useEffect(() => {
    if (isOnline || !notificationsEnabled || overdueTasks.length === 0) return;

    const now = new Date(notificationClock);

    overdueTasks.forEach((task) => {
      if (shouldSuppressHolidayNotification(task)) return;

      const dueDate = parseISO(task.dueDate);
      const overdueExpiresAt = task.overdueExpiresAt
        ? parseISO(task.overdueExpiresAt)
        : buildOverdueExpiresAt(dueDate, task);
      if (overdueExpiresAt && now > overdueExpiresAt) return;

      const minutesOverdue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / 60000));
      const overdueWindowMinutes = overdueExpiresAt
        ? Math.max(0, Math.floor((overdueExpiresAt.getTime() - dueDate.getTime()) / 60000))
        : Number.POSITIVE_INFINITY;
      const overdueSequence = getOverdueReminderSequence(
        minutesOverdue,
        task.overdueReminderIntensity ?? 'normal',
        overdueWindowMinutes,
      );
      if (!overdueSequence) return;

      emitLocalOfflineNotification(
        'Lembrete atrasado',
        overdueSequence.sequenceIndex === 0
          ? `"${task.title}" passou do prazo e precisa da sua atenção.`
          : `"${task.title}" continua atrasado há ${formatOverdueDuration(minutesOverdue)}.`,
        'warning',
        {
          target: { type: 'task', taskId: task.id },
          dedupeKey: `overdue:${task.id}:${overdueSequence.sequenceIndex}`,
          kind: 'overdue_reminder',
          actions: [
            { action: 'overdue_snooze_10', title: '10 min' },
            { action: 'overdue_snooze_60', title: '1 hora' },
            { action: 'overdue_snooze_tomorrow', title: 'Amanhã' },
          ],
        },
      );
    });
  }, [emitLocalOfflineNotification, isOnline, notificationClock, notificationsEnabled, overdueTasks, shouldSuppressHolidayNotification]);

  useEffect(() => {
    if (isOnline || !notificationsEnabled || timedActiveTasks.length === 0) return;

    const now = new Date(notificationClock);

    timedActiveTasks.forEach((task) => {
      if (shouldSuppressHolidayNotification(task)) return;

      const dueDate = parseISO(task.dueDate);
      const millisecondsSinceDue = now.getTime() - dueDate.getTime();
      if (millisecondsSinceDue < 0 || millisecondsSinceDue >= 60_000) return;

      emitLocalOfflineNotification(
        'Lembrete para agora',
        `"${task.title}" chegou ao horário definido.`,
        'info',
        {
          target: { type: 'task', taskId: task.id },
          dedupeKey: `due:${task.id}:${format(dueDate, 'yyyy-MM-dd-HH-mm')}`,
          kind: 'notification',
        },
      );
    });
  }, [emitLocalOfflineNotification, isOnline, notificationClock, notificationsEnabled, shouldSuppressHolidayNotification, timedActiveTasks]);

  useEffect(() => {
    if (isOnline || !notificationsEnabled || timedPendingTasks.length === 0) return;

    const now = new Date(notificationClock);

    timedPendingTasks.forEach((task) => {
      if (shouldSuppressHolidayNotification(task)) return;

      const dueDate = parseISO(task.dueDate);
      const minutesUntil = getMinutesDifference(dueDate, now);

      if (minutesUntil <= 0 || minutesUntil > UPCOMING_REMINDER_MINUTES) return;

      emitLocalOfflineNotification(
        task.alarmEnabled
          ? `Alarme em ${minutesUntil} minuto${minutesUntil === 1 ? '' : 's'}`
          : `Lembrete em ${minutesUntil} minuto${minutesUntil === 1 ? '' : 's'}`,
        task.alarmEnabled
          ? `O alarme do seu lembrete vai tocar em ${minutesUntil} minuto${minutesUntil === 1 ? '' : 's'}! "${task.title}" está chegando.`
          : `"${task.title}" está chegando. Falta pouco para o horário definido.`,
        task.alarmEnabled || minutesUntil <= 5 ? 'warning' : 'info',
        {
          target: { type: 'task', taskId: task.id },
          dedupeKey: `${task.alarmEnabled ? 'alarm-warning' : 'upcoming'}:${task.id}:${format(dueDate, 'yyyy-MM-dd-HH-mm')}:${UPCOMING_REMINDER_MINUTES}`,
          kind: 'pre_notice',
        },
      );
    });
  }, [emitLocalOfflineNotification, isOnline, notificationClock, notificationsEnabled, shouldSuppressHolidayNotification, timedPendingTasks]);

  useEffect(() => {
    if (!notificationsEnabled || timedPendingTasks.length === 0 || activeAlarm) return;

    const now = new Date(notificationClock).getTime();

    for (const task of timedPendingTasks) {
      if (!task.alarmEnabled) continue;

      const dueTime = parseISO(task.dueDate).getTime();
      if (Number.isNaN(dueTime)) continue;

      const alarmKey = `${task.id}:${format(new Date(dueTime), 'yyyy-MM-dd-HH-mm')}`;
      if (alarmDismissedKeysRef.current.has(alarmKey)) continue;

      const snoozeUntil = alarmSnoozeUntilRef.current.get(alarmKey);
      const targetTime = snoozeUntil ?? dueTime;
      const hasReachedAlarm = now >= targetTime && now < targetTime + ALARM_RING_DURATION_MS;
      if (!hasReachedAlarm) continue;

      alarmSnoozeUntilRef.current.delete(alarmKey);
      setActiveAlarm({
        taskId: task.id,
        taskTitle: task.title,
        dueDate: task.dueDate,
        startedAt: now,
      });
      break;
    }
  }, [
    activeAlarm,
    notificationClock,
    notificationsEnabled,
    timedPendingTasks,
  ]);

  useEffect(() => {
    if (isOnline || !notificationsEnabled || todayTasks.length === 0) return;

    todayTasks.forEach((task) => {
      if (shouldSuppressHolidayNotification(task)) return;

      const dueDate = parseISO(task.dueDate);
      emitLocalOfflineNotification(
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
  }, [emitLocalOfflineNotification, isOnline, notificationClock, notificationsEnabled, shouldSuppressHolidayNotification, todayTasks]);

  useEffect(() => {
    if (isOnline || !notificationsEnabled || tomorrowTasks.length === 0) return;

    tomorrowTasks.forEach((task) => {
      if (shouldSuppressHolidayNotification(task)) return;

      const dueDate = parseISO(task.dueDate);
      emitLocalOfflineNotification(
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
  }, [emitLocalOfflineNotification, isOnline, notificationClock, notificationsEnabled, shouldSuppressHolidayNotification, tomorrowTasks]);

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
    setTasksPageView('agenda');
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
    const action = params.get('action');
    const notificationTarget = params.get('notificationTarget');
    const connectedCalendar = params.get('calendar_connected');
    const calendarError = params.get('calendar_error');

    if (action === 'new-task' && auth.currentUser) {
      openNewTask();
      params.delete('action');
    } else if (connectedCalendar) {
      openSettings('organization');
      triggerToastOnly(
        'Calendário conectado',
        connectedCalendar === 'google'
          ? 'Google Calendar está pronto para receber novos lembretes.'
          : 'Outlook Calendar está pronto para receber novos lembretes.',
      );
      void refreshCalendarIntegrations().catch(() => {
        // best effort after OAuth redirect
      });
      params.delete('calendar_connected');
    } else if (calendarError) {
      openSettings('organization');
      triggerToastOnly('Conexão não concluída', calendarError);
      params.delete('calendar_error');
    } else if (notificationTarget) {
      if (!auth.token) return;

      if (notificationTarget === 'task') {
        const taskId = params.get('taskId');
        if (taskId) {
          const notificationAction = params.get('notificationAction');
          const snoozePreset = params.get('snoozePreset');
          const notificationId = params.get('notificationId');
          const scheduleId = params.get('scheduleId');

          if (
            notificationAction === 'overdueSnooze' &&
            isOverdueNotificationSnoozePreset(snoozePreset)
          ) {
            void handleSnoozeOverdueNotification({
              id: notificationId ?? `push-action:${taskId}:${snoozePreset}`,
              title: 'Lembrete atrasado',
              message: '',
              createdAt: new Date().toISOString(),
              read: true,
              tone: 'warning',
              target: { type: 'task', taskId },
              kind: 'overdue_reminder',
            }, snoozePreset);
          } else if (notificationAction === 'alarmSnooze' && scheduleId) {
            void apiPost(
              `/api/notifications/alarms/${scheduleId}/snooze`,
              { minutes: ALARM_SNOOZE_MINUTES },
              auth.token,
            ).then(() => {
              triggerToastOnly('Alarme adiado', `Vamos tocar novamente em ${ALARM_SNOOZE_MINUTES} minutos.`);
              stopAlarmSound();
              setActiveAlarm(null);
            }).catch(() => {
              setActiveTab('tasks');
              setPendingNotificationTaskId(taskId);
            });
          } else {
            setActiveTab('tasks');
            setPendingNotificationTaskId(taskId);
          }
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
      params.delete('notificationAction');
      params.delete('snoozePreset');
      params.delete('notificationId');
      params.delete('scheduleId');
    } else {
      return;
    }

    const nextSearch = params.toString();
    const nextUrl = nextSearch.length > 0
      ? `${window.location.pathname}?${nextSearch}`
      : window.location.pathname;

    window.history.replaceState({}, '', nextUrl);
    setLocationSearch(nextSearch.length > 0 ? `?${nextSearch}` : '');
  }, [
    auth.currentUser,
    auth.restoring,
    auth.token,
    locationSearch,
    handleSnoozeOverdueNotification,
    openNotificationsCenter,
    openNewTask,
    openProfile,
    openSettings,
    refreshCalendarIntegrations,
    stopAlarmSound,
    triggerToastOnly,
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
    return (
      <Suspense fallback={<LoadingScreen />}>
        <ResetPage onBackToLogin={() => navigateTo('/')} />
      </Suspense>
    );
  }

  if (auth.restoring) {
    return <LoadingScreen />;
  }

  if (!auth.currentUser) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <AuthPage
          auth={auth}
          toastNotify={(title, message) => emitNotification(title, message, 'success', {
            target: { type: 'notifications' },
          })}
        />
      </Suspense>
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
      ? 'Organize lembretes, rascunhos, datas e feriados em áreas separadas.'
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
    <div className="flex h-[100dvh] min-h-[100dvh] w-full min-w-0 overflow-hidden text-slate-900 dark:text-slate-100">
      {!isSidebarHidden && (
        <Sidebar
          currentUser={auth.currentUser}
          activeTab={activeTab}
          setActiveTab={(tab) => {
            if (tab === 'tasks') setTasksPageView('agenda');
            setActiveTab(tab);
          }}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          categories={categoryOptions}
          pendingTasks={pendingTasks}
          todayCount={pendingSummary.todayCount}
          overdueCount={pendingSummary.overdueCount}
          onOpenProfile={openProfile}
          onOpenSettings={openSettings}
          onCreateCategory={createCategory}
          onDeleteCategory={handleDeleteCategory}
          onToggleVisibility={() => setIsSidebarHidden(true)}
          onLogout={auth.logout}
        />
      )}

      {isSidebarHidden && (
        <button
          type="button"
          onClick={() => setIsSidebarHidden(false)}
          aria-label="Mostrar sidebar"
          title="Mostrar sidebar"
          data-testid="sidebar-show-button"
          className="fixed left-4 top-4 z-50 hidden h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white/90 text-slate-600 shadow-[0_18px_40px_-26px_rgba(15,23,42,0.45)] backdrop-blur transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 dark:border-white/10 dark:bg-slate-950/88 dark:text-slate-200 dark:hover:border-blue-500/30 dark:hover:bg-blue-500/10 dark:hover:text-blue-300 lg:flex"
        >
          <PanelLeftOpen size={20} />
        </button>
      )}

      <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 dark:opacity-20" />

        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200/70 bg-white/88 p-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/86 sm:p-4 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_18px_30px_-22px_rgba(37,99,235,0.8)]">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                {activeTab === 'dashboard'
                  ? 'Painel'
                  : activeTab === 'calendar'
                    ? 'Agenda'
                    : activeTab === 'tasks'
                      ? 'Tarefas'
                      : activeTab === 'notes'
                        ? 'Notas'
                        : 'Avisos'}
              </p>
              <h1 className="text-lg font-semibold">Lembreto</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {pendingOfflineTaskCount > 0 && (
              <span
                data-testid="offline-sync-badge-mobile"
                className="inline-flex h-9 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
              >
                {isSyncingOfflineTasks ? 'Sync' : pendingOfflineTaskCount}
              </span>
            )}

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

        <div className="relative mx-auto w-full min-w-0 flex-1 max-w-7xl p-3 pb-28 sm:p-6 sm:pb-28 lg:p-8 lg:pb-8 xl:p-10">
          {!isMobileViewport && (
            <div className="surface-panel mb-4 p-4 md:mb-8 md:p-6">
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
                  <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-slate-950 dark:text-white md:mt-4 md:text-4xl">
                    {pageTitle}
                  </h2>
                  {pageDescription && (
                    <p className="mt-2 hidden max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400 sm:block md:text-base">
                      {pageDescription}
                    </p>
                  )}
                </div>

                <div className="hidden items-center gap-3 lg:flex">
                  {pendingOfflineTaskCount > 0 && (
                    <span
                      data-testid="offline-sync-badge"
                      className="inline-flex h-11 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
                    >
                      {isSyncingOfflineTasks
                        ? 'Enviando offline'
                        : `${pendingOfflineTaskCount} offline`}
                    </span>
                  )}

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

          <div className="mb-8 hidden flex-col justify-between gap-4 sm:flex-row sm:items-center lg:flex">
            {activeTab === 'tasks' && (
              <button
                onClick={openNewTask}
                data-testid="new-task-button"
                className="action-primary !hidden lg:!inline-flex"
              >
                <Plus size={20} /> Novo lembrete
              </button>
            )}
            {activeTab === 'notes' && (
              <button
                onClick={() => openNewNote()}
                data-testid="new-note-header-button"
                className="action-primary !hidden lg:!inline-flex"
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
              <Suspense fallback={<PageChunkFallback />}>
                {activeTab === 'dashboard' && (
                  <DashboardPage
                    tasks={dashboardTasks}
                    pendingTasks={pendingTasks}
                    overdueTasks={overdueTasks}
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
                    tasks={calendarTasks}
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
                    pendingTasks={taskListRows}
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
                    onToggleActive={handleToggleActiveTask}
                    onDelete={handleDelete}
                    onDeleteSelected={handleDeleteSelectedTasks}
                    onEdit={openTaskDetails}
                    drafts={draftTasks}
                    onEditDraft={openEditTask}
                    onPromoteDraft={handlePromoteDraft}
                    activeView={tasksPageView}
                    onActiveViewChange={setTasksPageView}
                    deletingTaskIds={deletingTaskIds}
                    promotingDraftIds={promotingDraftIds}
                    togglingTaskIds={togglingTaskIds}
                    togglingActiveTaskIds={togglingActiveTaskIds}
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
                    trashedNotes={trashedNotes}
                    tasks={tasks}
                    categories={categoryOptions}
                    onNewNote={() => openNewNote()}
                    onEditNote={(note) => openEditNote(note)}
                    onDeleteNote={handleDeleteNote}
                    onRestoreNote={openRestoreNote}
                  />
                )}
                {activeTab === 'notifications' && (
                  <NotificationsPage
                    notifications={notifications}
                    onMarkAllRead={markAllNotificationsRead}
                    onClearAll={clearNotifications}
                    onOpenNotification={handleOpenNotification}
                    onSnoozeOverdueNotification={handleSnoozeOverdueNotification}
                    isNotificationActionBusy={isNotificationActionBusy}
                  />
                )}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/80 bg-white/94 pb-[max(env(safe-area-inset-bottom),0px)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/92 lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-[1fr_1fr_auto_1fr_1fr] items-center gap-1 p-2">
          <button
            onClick={openDashboardTab}
            aria-label="Abrir dashboard"
            className={cn(
              'flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 transition-colors',
              activeTab === 'dashboard' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'text-slate-500'
            )}
            >
              <Sparkles size={22} />
              <span className="text-[10px] font-semibold leading-none">Painel</span>
            </button>
          <button
            onClick={openCalendarTab}
            aria-label="Abrir calendário"
            className={cn(
              'flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 transition-colors',
              activeTab === 'calendar' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'text-slate-500',
            )}
          >
            <CalendarDays size={22} />
            <span className="text-[10px] font-semibold leading-none">Agenda</span>
          </button>
          <div className="relative -top-5">
            <button
              onClick={openNewTask}
              aria-label="Criar novo lembrete"
              className="flex h-14 w-14 items-center justify-center rounded-full border-[5px] border-slate-100 bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_24px_40px_-22px_rgba(37,99,235,0.7)] transition-transform active:scale-95 dark:border-slate-950"
            >
              <Plus size={28} />
            </button>
          </div>
          <button
            onClick={openTasksTab}
            aria-label="Abrir lista de lembretes"
            className={cn(
              'relative flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 transition-colors',
              activeTab === 'tasks' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'text-slate-500'
            )}
          >
            <ListTodo size={22} />
            <span className="text-[10px] font-semibold leading-none">Tarefas</span>
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
              'flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 transition-colors',
              activeTab === 'notes' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' : 'text-slate-500',
            )}
          >
            <NotebookPen size={22} />
            <span className="text-[10px] font-semibold leading-none">Notas</span>
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {activeAlarm && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="fixed inset-x-3 bottom-24 z-[130] mx-auto max-w-xl rounded-[28px] border border-amber-200 bg-white p-4 shadow-[0_32px_90px_-38px_rgba(15,23,42,0.62)] dark:border-amber-500/20 dark:bg-slate-950 sm:bottom-6 sm:p-5"
            data-testid="active-alarm-panel"
            role="alertdialog"
            aria-labelledby="active-alarm-title"
          >
            <div className="flex items-start gap-3">
              <span className="icon-slot h-12 w-12 rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                <BellRing size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <p id="active-alarm-title" className="text-sm font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
                  Alarme tocando
                </p>
                <h3 className="mt-1 truncate text-lg font-semibold text-slate-950 dark:text-white">
                  {activeAlarm.taskTitle}
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  O alarme do seu lembrete está tocando agora.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                data-testid="active-alarm-snooze"
                onClick={snoozeActiveAlarm}
                className="action-secondary justify-center"
              >
                Adiar 10 minutos
              </button>
              <button
                type="button"
                data-testid="active-alarm-close"
                onClick={closeActiveAlarm}
                className="action-primary justify-center"
              >
                Fechar alarme
              </button>
              <button
                type="button"
                data-testid="active-alarm-complete"
                onClick={completeActiveAlarmTask}
                className="action-primary justify-center"
              >
                Concluir
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Suspense fallback={null}>
        {shouldRenderTaskDetails && (
          <TaskDetailsDialog
            open={showTaskDetails && Boolean(selectedTask)}
            task={selectedTask}
            linkedNotes={selectedTask ? notesByTask.get(selectedTask.id) ?? [] : []}
            isDeleting={selectedTask ? deletingTaskIds.has(selectedTask.id) : false}
            isToggling={selectedTask ? togglingTaskIds.has(selectedTask.id) : false}
            isRescheduling={selectedTask ? reschedulingTaskIds.has(selectedTask.id) : false}
            isSyncingCalendar={selectedTask ? syncingCalendarTaskIds.has(selectedTask.id) : false}
            isTogglingActive={selectedTask ? togglingActiveTaskIds.has(selectedTask.id) : false}
            backLabel={taskDetailsBackLabel || undefined}
            onClose={closeTaskDetails}
            onBack={taskDetailsReturnMetric ? returnToDashboardMetric : undefined}
            onEdit={openEditTask}
            onDuplicate={openDuplicateTask}
            onShare={handleShareTask}
            onSyncCalendar={handleSyncTaskCalendar}
            onQuickReschedule={handleQuickReschedule}
            onToggle={handleToggleFromDetails}
            onToggleActive={handleToggleActiveTask}
            onDelete={handleDeleteFromDetails}
            onCreateLinkedNote={openNewNote}
            onEditLinkedNote={(note, task) => openEditNote(note, { taskContextId: task.id })}
            onDeleteLinkedNote={handleDeleteNote}
          />
        )}

        {shouldRenderDashboardMetric && (
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
        )}

        {shouldRenderTaskDrawer && (
          <TaskDrawer
            open={showTaskDrawer}
            onClose={resetTaskForm}
            onSubmit={handleSubmitTask}
            onSaveDraft={handleSaveTaskDraft}
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
            endTime={formEndTime}
            setEndTime={setFormEndTime}
            noTimeReminderFallbackTime={noTimeReminderFallbackTime}
            dueDateError={taskDueDateError}
            endTimeError={taskEndTimeError}
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
            overdueReminderIntensity={formOverdueReminderIntensity}
            setOverdueReminderIntensity={setFormOverdueReminderIntensity}
            alarmEnabled={formAlarmEnabled}
            setAlarmEnabled={setFormAlarmEnabled}
            recurrenceError={recurrenceError}
            recurrencePreviewCount={recurringDates.length}
            holidaySuppressedCount={recurringHolidaySuppressedCount}
            onApplyRecurrenceSuggestion={applyRecurrenceSuggestion}
          />
        )}

        {shouldRenderNoteDrawer && (
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
            expiresAt={noteExpiresAt}
            setExpiresAt={setNoteExpiresAt}
            isRestoring={isRestoringNote}
            taskId={noteTaskId}
            setTaskId={setNoteTaskId}
            tasks={tasks}
            lockedTask={noteContextTask}
            lockedTaskId={noteContextTaskId}
          />
        )}

        {shouldRenderProfileDrawer && (
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
        )}

        {shouldRenderSettingsDrawer && (
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
            desktopNotificationsEnabled={desktopNotificationsEnabled}
            desktopNotificationsReady={desktopNotificationsReady}
            desktopNotificationsPermission={notifPerm}
            desktopNotificationsConfigured={pushConfigured}
            desktopNotificationsError={desktopPushError}
            isSyncingDesktopNotifications={isSyncingDesktopNotifications}
            onToggleDesktopNotifications={() => {
              void handleToggleDesktopNotifications();
            }}
            onOpenNotificationsCenter={openNotificationsCenter}
            onOpenProfile={openProfile}
            sound={configSound}
            onToggleSound={() => saveConfig({ sound: !configSound })}
            confirmDelete={configConfirmDelete}
            onToggleConfirmDelete={() => saveConfig({ confirmDelete: !configConfirmDelete })}
            showCompleted={configShowCompleted}
            onToggleShowCompleted={() => saveConfig({ showCompleted: !configShowCompleted })}
            noTimeReminderMinutes={configNoTimeReminderMinutes}
            onChangeNoTimeReminderMinutes={(minutes) => saveConfig({ noTimeReminderMinutes: minutes })}
            categories={categoryOptions}
            tags={tagOptions}
            onCreateCategory={createCategory}
            onCreateTag={createTag}
            onDeleteCategory={handleDeleteCategory}
            onDeleteTag={handleDeleteTag}
            onDownloadCalendar={downloadCalendarExport}
            onCopyCalendarFeed={copyCalendarFeed}
            onRotateCalendarFeed={rotateCalendarFeed}
            calendarIntegrations={calendarIntegrations}
            isLoadingCalendarIntegrations={isLoadingCalendarIntegrations}
            onConnectCalendar={handleConnectCalendar}
            onDisconnectCalendar={handleDisconnectCalendar}
            onToggleCalendarSync={handleToggleCalendarSync}
            onSyncAllCalendar={handleSyncAllCalendar}
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
        )}

        {shouldRenderNotificationsInbox && (
          <NotificationsInboxDrawer
            open={showNotificationsInbox}
            notifications={notifications}
            unreadCount={unreadNotifications}
            onClose={closeNotificationsInbox}
            onOpenNotification={handleOpenNotification}
            onPreviewNotification={handlePreviewNotification}
            onSnoozeOverdueNotification={handleSnoozeOverdueNotification}
            isNotificationActionBusy={isNotificationActionBusy}
            onOpenCenter={openNotificationsCenter}
          />
        )}
      </Suspense>

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
              ? `Você está prestes a mover "${pendingDeleteNote.title}" para a Lixeira. A nota poderá ser reativada por 3 dias antes da exclusão permanente.`
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
