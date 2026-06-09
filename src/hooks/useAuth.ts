import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { apiDelete, apiGet, apiPost, apiPut, resolveApiUrl } from '../api/client';
import {
  clearMobileAuthToken,
  isNativeMobileRuntime,
  loadMobileAuthToken,
  saveMobileAuthToken,
} from '../lib/mobileSession';
import { LS } from '../lib/storage';
import type { User } from '../types';

const MOBILE_GOOGLE_CALLBACK_PROTOCOL = 'com.lembreto.app:';
const MOBILE_GOOGLE_CALLBACK_HOST = 'auth';
const MOBILE_GOOGLE_CALLBACK_PATH = '/google/callback';

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

function assertAuthResponse(data: { user?: User; token?: string }): asserts data is { user: User; token: string } {
  if (!data.user || typeof data.user.name !== 'string' || !data.token) {
    throw new Error('Resposta de autenticaÃ§Ã£o invÃ¡lida. Verifique a URL da API e tente novamente.');
  }
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const restoredRef = useRef(false);

  const restoreSession = useCallback(async () => {
    try {
      const mobileToken = await loadMobileAuthToken();
      const response = await fetch(resolveApiUrl('/api/auth/me'), {
        credentials: 'include',
        headers: mobileToken ? { Authorization: `Bearer ${mobileToken}` } : undefined,
      });

      if (response.ok) {
        const data = await response.json() as { user: User; token: string };
        setCurrentUser(data.user);
        setToken(data.token);
        LS.saveUser(data.user);
        await saveMobileAuthToken(data.token);
      } else {
        await clearMobileAuthToken();
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
    if (isNativeMobileRuntime()) return;

    try {
      const response = await fetch(resolveApiUrl('/api/auth/me'), {
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

  const completeNativeGoogleLogin = useCallback(async (newToken: string) => {
    const response = await fetch(resolveApiUrl('/api/auth/me'), {
      credentials: 'include',
      headers: { Authorization: `Bearer ${newToken}` },
    });

    if (!response.ok) {
      throw new Error('Falha ao validar a sessão Google no aplicativo.');
    }

    const data = await response.json() as { user: User; token: string };
    assertAuthResponse(data);
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    await saveMobileAuthToken(data.token);
  }, []);

  useEffect(() => {
    if (!isNativeMobileRuntime()) return undefined;

    let disposed = false;
    let listener: { remove: () => Promise<void> } | undefined;

    void CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return;
      }

      if (
        parsedUrl.protocol !== MOBILE_GOOGLE_CALLBACK_PROTOCOL ||
        parsedUrl.hostname !== MOBILE_GOOGLE_CALLBACK_HOST ||
        parsedUrl.pathname !== MOBILE_GOOGLE_CALLBACK_PATH
      ) {
        return;
      }

      await Browser.close().catch(() => undefined);

      const authError = parsedUrl.searchParams.get('auth_error');
      if (authError) {
        window.location.assign(`/?auth_error=${encodeURIComponent(authError)}`);
        return;
      }

      const googleToken = parsedUrl.searchParams.get('token');
      if (!googleToken) {
        window.location.assign('/?auth_error=Não foi possível concluir o login com Google.');
        return;
      }

      try {
        await completeNativeGoogleLogin(googleToken);
        window.history.replaceState(null, '', '/');
      } catch {
        await clearMobileAuthToken();
        window.location.assign('/?auth_error=Falha ao concluir login com Google.');
      }
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
        return;
      }

      listener = handle;
    });

    return () => {
      disposed = true;
      if (listener) void listener.remove();
    };
  }, [completeNativeGoogleLogin]);

  const login = async (email: string, password: string, recaptchaToken?: string) => {
    const data = await apiPost<{ user: User; token: string }>('/api/auth/login', {
      email,
      password,
      ...(recaptchaToken ? { recaptchaToken } : {}),
    });
    assertAuthResponse(data);
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    await saveMobileAuthToken(data.token);
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
    assertAuthResponse(data);
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    await saveMobileAuthToken(data.token);
    await persistTokenCookie(data.token);
    return data.user;
  };

  const logout = async () => {
    const currentToken = token;

    LS.clearUser();
    await clearMobileAuthToken();
    setCurrentUser(null);
    setToken(null);

    const requests: Promise<unknown>[] = [];

    if (currentToken) {
      requests.push(fetch(resolveApiUrl('/api/auth/logout'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
      }));
    }

    requests.push(fetch(resolveApiUrl('/api/auth/me'), {
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
    const googleStartUrl = resolveApiUrl(`/api/auth/google/start${isNativeMobileRuntime() ? '?client=native' : ''}`);
    if (isNativeMobileRuntime()) {
      void Browser.open({ url: googleStartUrl }).catch(() => {
        window.location.assign(googleStartUrl);
      });
      return;
    }

    window.location.assign(googleStartUrl);
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
      await saveMobileAuthToken(data.token);
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
      await clearMobileAuthToken();
      setCurrentUser(null);
      setToken(null);
    }
    return data;
  };

  const cancelAccount = async () => {
    if (!token) throw new Error('Não autenticado');
    const data = await apiDelete<{ message: string }>('/api/auth/account', token);
    LS.clearUser();
    await clearMobileAuthToken();
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
