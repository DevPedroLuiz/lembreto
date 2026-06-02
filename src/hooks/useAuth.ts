import { useCallback, useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import { LS } from '../lib/storage';
import type { User } from '../types';

export interface AuthSession {
  id: string;
  userId: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  current: boolean;
}

export interface AuthState {
  currentUser: User | null;
  token: string | null;
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const restoredRef = useRef(false);

  const restoreSession = useCallback(async () => {
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
      const cachedUser = LS.loadUser();
      setCurrentUser(cachedUser);
      setToken(null);
    } finally {
      setRestoring(false);
    }
  }, []);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (token) return undefined;

    const restoreIfPossible = () => {
      void restoreSession();
    };

    window.addEventListener('online', restoreIfPossible);
    window.addEventListener('focus', restoreIfPossible);
    return () => {
      window.removeEventListener('online', restoreIfPossible);
      window.removeEventListener('focus', restoreIfPossible);
    };
  }, [restoreSession, token]);

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

  const login = async (email: string, password: string, recaptchaToken?: string) => {
    const data = await apiPost<{ user: User; token: string }>('/api/auth/login', {
      email,
      password,
      ...(recaptchaToken ? { recaptchaToken } : {}),
    });
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    await persistTokenCookie(data.token);
    return data.user;
  };

  const register = async (name: string, email: string, password: string, recaptchaToken?: string) => {
    const data = await apiPost<{ user: User; token: string }>('/api/auth/register', {
      name: name.trim(),
      email,
      password,
      ...(recaptchaToken ? { recaptchaToken } : {}),
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

  const recoverPassword = async (email: string, recaptchaToken?: string) => {
    return apiPost<{ message: string }>('/api/auth/recover', {
      email,
      ...(recaptchaToken ? { recaptchaToken } : {}),
    });
  };

  const loginWithGoogle = () => {
    window.location.assign('/api/auth/google/start');
  };

  const updateProfile = async (payload: {
    name?: string;
    email?: string;
    currentPassword?: string;
    password?: string;
    avatar?: string | null;
    stateCode?: string | null;
    cityName?: string | null;
    holidayRegionCode?: string | null;
  }) => {
    if (!token) throw new Error('Não autenticado');

    const data = await apiPut<{ user: User; token?: string }>('/api/auth/profile', payload, token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);

    if (data.token) {
      setToken(data.token);
      await persistTokenCookie(data.token);
    }

    return data;
  };

  const resendVerificationEmail = async () => {
    if (!token) throw new Error('Não autenticado');
    return apiPost<{ message: string }>('/api/auth/verify-email/resend', {}, token);
  };

  const listSessions = async () => {
    if (!token) throw new Error('Não autenticado');
    const data = await apiGet<{ sessions: AuthSession[] }>('/api/auth/sessions', token);
    return data.sessions;
  };

  const revokeSession = async (sessionId: string) => {
    if (!token) throw new Error('Não autenticado');
    const data = await apiDelete<{ revokedCurrent?: boolean }>('/api/auth/sessions', token, { sessionId });
    if (data?.revokedCurrent) {
      LS.clearUser();
      setCurrentUser(null);
      setToken(null);
    }
    return data;
  };

  const cancelAccount = async () => {
    if (!token) throw new Error('Não autenticado');
    const data = await apiDelete<{ message: string }>('/api/auth/account', token);
    LS.clearUser();
    setCurrentUser(null);
    setToken(null);
    return data;
  };

  return {
    currentUser,
    token,
    restoring,
    login,
    loginWithGoogle,
    register,
    logout,
    recoverPassword,
    updateProfile,
    restoreSession,
    resendVerificationEmail,
    listSessions,
    revokeSession,
    cancelAccount,
  };
}
