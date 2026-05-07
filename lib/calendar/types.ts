import type {
  CalendarProvider,
  ExternalCalendarSyncStatus,
  TaskPriority,
  TaskStatus,
} from '../contracts.js';

export type { CalendarProvider, ExternalCalendarSyncStatus };

export interface CalendarIntegration {
  id: string;
  userId: string;
  provider: CalendarProvider;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  expiresAt: string | null;
  calendarId: string;
  syncEnabled: boolean;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicCalendarIntegration {
  provider: CalendarProvider;
  connected: boolean;
  syncEnabled: boolean;
  calendarId: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

export interface CalendarTaskForSync {
  id: string;
  userId: string;
  title: string;
  description: string;
  dueDate: string | null;
  priority: TaskPriority;
  category: string;
  tags: string[];
  status: TaskStatus;
  externalCalendarProvider: CalendarProvider | null;
  externalCalendarEventId: string | null;
  externalCalendarSyncStatus: ExternalCalendarSyncStatus;
  externalCalendarLastError: string | null;
  externalCalendarSyncedAt: string | null;
}

export interface CalendarTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}

export interface CalendarEventInput {
  title: string;
  description: string;
  dueDate: string;
  category: string;
  tags: string[];
}

export interface CalendarProviderClient {
  exchangeCode(code: string, redirectUri: string): Promise<CalendarTokenSet>;
  refreshTokens(refreshToken: string): Promise<CalendarTokenSet>;
  createEvent(accessToken: string, calendarId: string, event: CalendarEventInput): Promise<string>;
  updateEvent(accessToken: string, calendarId: string, eventId: string, event: CalendarEventInput): Promise<string>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
}
