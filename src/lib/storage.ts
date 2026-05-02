// src/lib/storage.ts
// Typed localStorage helpers — keeps storage logic in one place

import type { User } from '../types';
import type { AppNotification } from '../types';

export interface AppConfig {
  darkMode?: boolean;
  notifications?: boolean;
  sound?: boolean;
  confirmDelete?: boolean;
  showCompleted?: boolean;
  taskSortMode?: string;
  taskPriorityFilter?: string;
  taskStatusFilter?: string;
  taskTagFilter?: string;
  taskDateFilterMode?: string;
  taskDateFilterStart?: string;
  taskDateFilterEnd?: string;
}

export const LS = {
  saveUser: (user: User) =>
    localStorage.setItem('tm_user', JSON.stringify(user)),

  loadUser: (): User | null => {
    try {
      const raw = localStorage.getItem('tm_user');
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  },

  clearUser: () => localStorage.removeItem('tm_user'),

  saveRememberedEmail: (email: string) =>
    localStorage.setItem('tm_remembered_email', email),

  loadRememberedEmail: (): string => localStorage.getItem('tm_remembered_email') || '',

  clearRememberedEmail: () => localStorage.removeItem('tm_remembered_email'),

  getConfig: (): AppConfig => {
    try {
      return JSON.parse(localStorage.getItem('tm_config') || '{}') as AppConfig;
    } catch {
      return {};
    }
  },

  saveConfig: (cfg: AppConfig) =>
    localStorage.setItem('tm_config', JSON.stringify(cfg)),

  saveNotifications: (notifications: AppNotification[]) =>
    localStorage.setItem('tm_notifications', JSON.stringify(notifications)),

  loadNotifications: (): AppNotification[] => {
    try {
      return JSON.parse(localStorage.getItem('tm_notifications') || '[]') as AppNotification[];
    } catch {
      return [];
    }
  },
};
