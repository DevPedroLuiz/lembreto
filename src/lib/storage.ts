// src/lib/storage.ts
// Typed localStorage helpers — keeps storage logic in one place

import type { User } from '../types';

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

  getConfig: (): Record<string, unknown> => {
    try {
      return JSON.parse(localStorage.getItem('tm_config') || '{}');
    } catch {
      return {};
    }
  },

  saveConfig: (cfg: object) =>
    localStorage.setItem('tm_config', JSON.stringify(cfg)),
};
