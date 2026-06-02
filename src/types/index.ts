import type {
  CalendarProvider,
  ExternalCalendarSyncStatus,
  NoteMode as NoteModeContract,
  OverdueReminderIntensity,
  TaskPriority,
  TaskStatus,
} from '../../lib/contracts';

export type Priority = TaskPriority;
export type Status = TaskStatus;
export type NoteMode = NoteModeContract;
export type TaskOverdueReminderIntensity = OverdueReminderIntensity;

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt?: string | null;
  avatar?: string | null;
  stateCode?: string | null;
  cityName?: string | null;
  holidayRegionCode?: string | null;
}

export interface Task {
  id: string;
  userId: string;
  clientMutationId?: string | null;
  title: string;
  description: string;
  dueDate: string | null;
  endDate?: string | null;
  priority: Priority;
  category: string;
  tags: string[];
  suppressHolidayNotifications: boolean;
  overdueReminderIntensity?: TaskOverdueReminderIntensity;
  alarmEnabled: boolean;
  preNoticeMinutes?: number | null;
  reminderMode?: 'timed' | 'floating';
  expiresAt?: string | null;
  overdueSince?: string | null;
  overdueExpiresAt?: string | null;
  completedAt?: string | null;
  completionSource?: 'user' | 'system' | 'calendar_sync' | null;
  deletedAt?: string | null;
  mutedUntil?: string | null;
  autoDeletedReason?: string | null;
  autoDeletedAt?: string | null;
  status: Status;
  createdAt: string;
  syncStatus?: 'pending';
  externalCalendarProvider?: CalendarProvider | null;
  externalCalendarEventId?: string | null;
  externalCalendarSyncStatus?: ExternalCalendarSyncStatus;
  externalCalendarLastError?: string | null;
  externalCalendarSyncedAt?: string | null;
  history?: TaskHistoryEvent[];
}

export interface TaskListResponse {
  items: Task[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  sort: 'created' | 'dueDate' | 'priority' | 'category';
  filters: {
    status: 'pending' | 'overdue' | 'completed' | 'inactive' | 'cancelled' | null;
    search: string | null;
    priority: Priority | null;
    category: string | null;
    tag: string | null;
    dueStart?: string | null;
    dueEnd?: string | null;
  };
}

export type CalendarIntegrationProvider = CalendarProvider;

export interface CalendarIntegrationStatus {
  provider: CalendarIntegrationProvider;
  connected: boolean;
  syncEnabled: boolean;
  calendarId: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

export interface CalendarSyncAllResult {
  provider: CalendarIntegrationProvider;
  pushed: number;
  imported: number;
  skipped: number;
  deduplicated: number;
  failed: number;
  errors: string[];
}

export type TaskHistoryAction =
  | 'created'
  | 'updated'
  | 'rescheduled'
  | 'completed'
  | 'reopened';

export interface TaskHistoryEvent {
  id: string;
  action: TaskHistoryAction;
  title: string;
  description: string;
  createdAt: string;
  details?: string[];
}

export interface TaskTaxonomy {
  categories: string[];
  tags: string[];
}

export type NotificationScheduleKind =
  | 'pre_notice'
  | 'notification'
  | 'alarm'
  | 'floating_reminder'
  | 'overdue_reminder';

export type NotificationScheduleStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';

export interface NotificationScheduleQueueItem {
  id: string;
  userId: string;
  taskId: string;
  taskTitle: string;
  kind: NotificationScheduleKind;
  notifyAt: string;
  status: NotificationScheduleStatus;
  title: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  sequenceIndex?: number | null;
  intervalMinutes?: number | null;
  processingStartedAt?: string | null;
  sentAt?: string | null;
  failedAt?: string | null;
  cancelledAt?: string | null;
  dismissedAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationScheduleDiagnostics {
  postgresNow: string | null;
  oldestPendingNotifyAt: string | null;
  duePendingCount: number;
  futurePendingCount: number;
  pendingByKind: Record<string, number>;
  dueByKind: Record<string, number>;
  processingCount: number;
  failedCount: number;
  cancelledCount: number;
}

export interface NotificationSchedulesResponse {
  schedules: NotificationScheduleQueueItem[];
  diagnostics: NotificationScheduleDiagnostics;
}

export type CategoryMessageTemplates = Record<string, string>;

export interface NotificationPreferences {
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  mutedCategories: string[];
  categoryMessageTemplates: CategoryMessageTemplates;
}

export interface HolidayRegionOption {
  code: string;
  name: string;
}

export interface HolidayLocationInfo {
  stateCode: string | null;
  stateName: string | null;
  cityName: string | null;
  regionCode: string | null;
  matchedRegionName: string | null;
  municipalSupported: boolean;
}

export interface HolidayLocationSuggestion extends HolidayLocationInfo {}

export interface HolidayEntry {
  id: string;
  name: string;
  date: string;
  type: string;
  scope: 'national' | 'state' | 'city';
}

export interface HolidayCalendarPayload {
  location: HolidayLocationInfo;
  today: HolidayEntry[];
  upcoming: HolidayEntry[];
  commemorative: HolidayEntry[];
  monthHighlights: HolidayEntry[];
  allEntries: HolidayEntry[];
  supportedCities: HolidayRegionOption[];
}

export interface Note {
  id: string;
  userId: string;
  taskId: string | null;
  title: string;
  content: string;
  priority: Priority;
  category: string;
  tags: string[];
  mode: NoteMode;
  expiresAt?: string | null;
  deletedAt?: string | null;
  deleteAfter?: string | null;
  deletionReason?: 'manual' | 'expired' | null;
  expiredNotificationSentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NotificationTarget =
  | { type: 'task'; taskId: string }
  | { type: 'notifications' }
  | { type: 'profile' }
  | { type: 'settings' };

export type OverdueNotificationSnoozePreset = 'tenMinutes' | 'oneHour' | 'tomorrow';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  tone: 'info' | 'success' | 'warning' | 'error';
  target?: NotificationTarget;
  dedupeKey?: string;
  sourceScheduleId?: string;
  kind?: 'pre_notice' | 'notification' | 'alarm' | 'floating_reminder' | 'overdue_reminder';
}

export const DEFAULT_CATEGORIES = ['Geral', 'Trabalho', 'Pessoal', 'Estudos'] as const;
