import type {
  CalendarProvider,
  ExternalCalendarSyncStatus,
  NoteMode as NoteModeContract,
  TaskPriority,
  TaskStatus,
} from '../../lib/contracts';

export type Priority = TaskPriority;
export type Status = TaskStatus;
export type NoteMode = NoteModeContract;

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  stateCode?: string | null;
  cityName?: string | null;
  holidayRegionCode?: string | null;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  dueDate: string;
  priority: Priority;
  category: string;
  tags: string[];
  suppressHolidayNotifications: boolean;
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

export type CalendarIntegrationProvider = CalendarProvider;

export interface CalendarIntegrationStatus {
  provider: CalendarIntegrationProvider;
  connected: boolean;
  syncEnabled: boolean;
  calendarId: string | null;
  lastError: string | null;
  updatedAt: string | null;
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
  createdAt: string;
  updatedAt: string;
}

export type NotificationTarget =
  | { type: 'task'; taskId: string }
  | { type: 'notifications' }
  | { type: 'profile' }
  | { type: 'settings' };

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  tone: 'info' | 'success' | 'warning' | 'error';
  target?: NotificationTarget;
  dedupeKey?: string;
}

export const DEFAULT_CATEGORIES = ['Geral', 'Trabalho', 'Pessoal', 'Estudos'] as const;
