import type { NoteMode as NoteModeContract, TaskPriority, TaskStatus } from '../../lib/contracts';

export type Priority = TaskPriority;
export type Status = TaskStatus;
export type NoteMode = NoteModeContract;

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
  tags: string[];
  status: Status;
  createdAt: string;
}

export interface TaskTaxonomy {
  categories: string[];
  tags: string[];
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
