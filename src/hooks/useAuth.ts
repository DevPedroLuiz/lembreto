import { useEffect, useRef, useState } from 'react';
import { apiPost, apiPut } from '../api/client';
import { LS } from '../lib/storage';
import type { User } from '../types';

export interface AuthState {
  currentUser: User | null;
  token: string | null;
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    (async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });

        if (response.ok) {
          const data = await response.json() as { user: User; token: string };
          setCurrentUser(data.user);
          setToken(data.token);
          LS.saveUser(data.user);
        } else {
          LS.clearUser();
          setCurrentUser(null);
          setToken(null);
        }
      } catch {
        LS.clearUser();
        setCurrentUser(null);
        setToken(null);
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  const persistTokenCookie = async (newToken: string) => {
    try {
      const response = await fetch('/api/auth/me', {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${newToken}` },
      });

      if (!response.ok) {
        throw new Error('Falha ao persistir o cookie de sessão');
      }
    } catch {
      console.warn('[useAuth] Não foi possível persistir a sessão em cookie.');
    }
  };

  const login = async (email: string, password: string) => {
    const data = await apiPost<{ user: User; token: string }>('/api/auth/login', { email, password });
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    await persistTokenCookie(data.token);
    return data.user;
  };

  const register = async (name: string, email: string, password: string) => {
    const data = await apiPost<{ user: User; token: string }>('/api/auth/register', {
      name: name.trim(),
      email,
      password,
    });
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    await persistTokenCookie(data.token);
    return data.user;
  };

  const logout = async () => {
    const currentToken = token;

    LS.clearUser();
    setCurrentUser(null);
    setToken(null);

    const requests: Promise<unknown>[] = [];

    if (currentToken) {
      requests.push(fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
      }));
    }

    requests.push(fetch('/api/auth/me', {
      method: 'DELETE',
      credentials: 'include',
    }));

    await Promise.allSettled(requests);
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

    const data = await apiPut<{ user: User; token?: string }>('/api/auth/profile', payload, token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);

    if (data.token) {
      setToken(data.token);
      await persistTokenCookie(data.token);
    }

    return data.user;
  };

  return {
    currentUser,
    token,
    restoring,
    login,
    register,
    logout,
    recoverPassword,
    updateProfile,
  };
}
