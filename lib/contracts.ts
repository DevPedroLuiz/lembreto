export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export const TASK_STATUSES = ['pending', 'completed'] as const;
export const NOTE_MODES = ['temporary', 'fixed'] as const;
export const NOTIFICATION_TONES = ['info', 'success', 'warning', 'error'] as const;
export const NOTIFICATION_TARGET_TYPES = ['task', 'notifications', 'profile', 'settings'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type NoteMode = (typeof NOTE_MODES)[number];
export type NotificationTone = (typeof NOTIFICATION_TONES)[number];
export type NotificationTargetType = (typeof NOTIFICATION_TARGET_TYPES)[number];
