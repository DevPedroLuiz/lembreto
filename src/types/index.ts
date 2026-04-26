import type { TaskPriority, TaskStatus } from '../../lib/contracts';

export type Priority = TaskPriority;
export type Status = TaskStatus;

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  dueDate: string;
  priority: Priority;
  category: string;
  status: Status;
  createdAt: string;
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

export const CATEGORIES = ['Geral', 'Trabalho', 'Pessoal', 'Estudos'] as const;
export type Category = (typeof CATEGORIES)[number];
