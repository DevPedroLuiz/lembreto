// src/hooks/useAuth.ts
// Encapsulates all authentication state and logic

import { useState } from 'react';
import { apiPost } from '../api/client';
import { LS } from '../lib/storage';
import type { User } from '../types';


export interface AuthState {
  currentUser: User | null;
  token: string | null;
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // Token lives ONLY in memory — never in localStorage/sessionStorage/cookie
  const [token, setToken] = useState<string | null>(null);

  // ── Login / Register ──────────────────────────────────────────────────────
  const login = async (email: string, password: string) => {
    const data = await apiPost<{ user: User; token: string }>(
      '/api/auth/login',
      { email, password }
    );
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    return data.user;
  };

  const register = async (name: string, email: string, password: string) => {
    const data = await apiPost<{ user: User; token: string }>(
      '/api/auth/register',
      { name: name.trim(), email, password }
    );
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    return data.user;
  };

  const logout = async () => {
    if (token) {
      // Fire-and-forget: invalidate token server-side
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => {});
    }
    LS.clearUser();
    setCurrentUser(null);
    setToken(null);
  };

  const recoverPassword = async (email: string) => {
    return apiPost<{ message: string }>('/api/auth/recover', { email });
  };

  const updateProfile = async (payload: {
    name?: string;
    email?: string;
    password?: string;
    avatar?: string | null;
  }) => {
    if (!token) throw new Error('Não autenticado');
    const { apiPut } = await import('../api/client');
    const data = await apiPut<{ user: User }>('/api/auth/profile', payload, token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    return data.user;
  };

  return {
    currentUser,
    token,
    login,
    register,
    logout,
    recoverPassword,
    updateProfile,
  };
}
