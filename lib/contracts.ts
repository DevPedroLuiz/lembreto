export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export const TASK_STATUSES = ['pending', 'overdue', 'completed', 'draft', 'inactive', 'cancelled'] as const;
export const NOTE_MODES = ['temporary', 'fixed'] as const;
export const NOTIFICATION_TONES = ['info', 'success', 'warning', 'error'] as const;
export const NOTIFICATION_TARGET_TYPES = ['task', 'notifications', 'profile', 'settings'] as const;
export const CALENDAR_PROVIDERS = ['google', 'outlook'] as const;
export const EXTERNAL_CALENDAR_SYNC_STATUSES = ['idle', 'pending', 'synced', 'failed'] as const;
export const REMINDER_MODES = ['timed', 'floating'] as const;
export const NOTIFICATION_SCHEDULE_KINDS = [
  'pre_notice',
  'notification',
  'alarm',
  'floating_reminder',
  'overdue_reminder',
] as const;
export const NOTIFICATION_SCHEDULE_STATUSES = ['pending', 'processing', 'sent', 'failed', 'cancelled'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type NoteMode = (typeof NOTE_MODES)[number];
export type NotificationTone = (typeof NOTIFICATION_TONES)[number];
export type NotificationTargetType = (typeof NOTIFICATION_TARGET_TYPES)[number];
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];
export type ExternalCalendarSyncStatus = (typeof EXTERNAL_CALENDAR_SYNC_STATUSES)[number];
export type ReminderMode = (typeof REMINDER_MODES)[number];
export type NotificationScheduleKind = (typeof NOTIFICATION_SCHEDULE_KINDS)[number];
export type NotificationScheduleStatus = (typeof NOTIFICATION_SCHEDULE_STATUSES)[number];

export function requiresWorkEndDateForStatus(status: string | undefined): boolean {
  return status === 'pending' || status === 'overdue';
}
