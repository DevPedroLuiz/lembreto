import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost, buildHeaders, resolveApiUrl } from '../api/client';
import { LS } from '../lib/storage';
import type { User } from '../types';

interface AuthResponse {
  user?: User;
  token?: string;
}

const configuredAppUrl = (import.meta.env.VITE_APP_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? '';
const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? '';

function assertAuthResponse(data: AuthResponse): asserts data is { user: User; token: string } {
  if (!data.user || typeof data.user.name !== 'string' || !data.token) {
    throw new Error('Resposta de autenticacao invalida. Verifique a URL da API e tente novamente.');
  }
}

function resolveAppUrl(path = '/') {
  if (/^[a-z][a-z\d+\-.]*:/i.test(path)) return path;
  const baseUrl = configuredAppUrl || configuredApiBaseUrl || window.location.origin;
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const restoredRef = useRef(false);

  const openApp = useCallback((path = '/') => {
    window.location.assign(resolveAppUrl(path));
  }, []);

  const scheduleOpenApp = useCallback(() => {
    window.setTimeout(() => openApp('/'), 650);
  }, [openApp]);

  const restoreSession = useCallback(async () => {
    try {
      const response = await fetch(resolveApiUrl('/api/auth/me'), {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json() as AuthResponse;
        assertAuthResponse(data);
        setCurrentUser(data.user);
        setToken(data.token);
        LS.saveUser(data.user);
        return;
      }

      LS.clearUser();
      setCurrentUser(null);
      setToken(null);
    } catch {
      setCurrentUser(LS.loadUser());
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

  const persistTokenCookie = async (newToken: string) => {
    await fetch(resolveApiUrl('/api/auth/me'), {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders(newToken),
    }).catch(() => undefined);
  };

  const login = async (email: string, password: string, recaptchaToken?: string) => {
    const data = await apiPost<AuthResponse>('/api/auth/login', {
      email,
      password,
      ...(recaptchaToken ? { recaptchaToken } : {}),
    });
    assertAuthResponse(data);
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    await persistTokenCookie(data.token);
    scheduleOpenApp();
    return data.user;
  };

  const register = async (name: string, email: string, password: string, recaptchaToken?: string) => {
    const data = await apiPost<AuthResponse>('/api/auth/register', {
      name: name.trim(),
      email,
      password,
      ...(recaptchaToken ? { recaptchaToken } : {}),
    });
    assertAuthResponse(data);
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    await persistTokenCookie(data.token);
    scheduleOpenApp();
    return data.user;
  };

  const recoverPassword = async (email: string, recaptchaToken?: string) => {
    return apiPost<{ message: string }>('/api/auth/recover', {
      email,
      ...(recaptchaToken ? { recaptchaToken } : {}),
    });
  };

  const loginWithGoogle = () => {
    window.location.assign(resolveApiUrl('/api/auth/google/start'));
  };

  const logout = async () => {
    LS.clearUser();
    setCurrentUser(null);
    setToken(null);

    await Promise.allSettled([
      token
        ? fetch(resolveApiUrl('/api/auth/logout'), {
            method: 'POST',
            credentials: 'include',
            headers: buildHeaders(token),
          })
        : Promise.resolve(),
      fetch(resolveApiUrl('/api/auth/me'), {
        method: 'DELETE',
        credentials: 'include',
      }),
    ]);
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
    restoreSession,
    openApp,
  };
}
