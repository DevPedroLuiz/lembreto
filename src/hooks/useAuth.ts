// src/hooks/useAuth.ts
// Encapsulates all authentication state and logic.
//
// SESSÃO PERSISTENTE via cookie HttpOnly:
//   - Após login/register, o token é salvo em cookie HttpOnly pelo endpoint /api/auth/me
//   - Ao carregar a página, restoreSession() consulta /api/auth/me para recuperar a sessão
//   - O token continua existindo APENAS em memória no cliente (nunca em localStorage)
//   - O cookie é HttpOnly, então JS não consegue lê-lo — proteção contra XSS

import { useState, useEffect, useRef } from 'react';
import { apiPost, apiPut } from '../api/client';
import { LS } from '../lib/storage';
import type { User } from '../types';

export interface AuthState {
  currentUser: User | null;
  token: string | null;
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // Token vive APENAS em memória — nunca em localStorage/sessionStorage
  const [token, setToken] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true); // true enquanto verifica sessão salva
  const restoredRef = useRef(false);

  // ── Restaura sessão ao carregar a página ──────────────────────────────────
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json() as { user: User; token: string };
          setCurrentUser(data.user);
          setToken(data.token);
          LS.saveUser(data.user);
        } else {
          // Sessão inválida ou expirada — limpa dados locais
          LS.clearUser();
        }
      } catch {
        // Falha de rede — tenta usuário em cache para não travar a UI
        const cached = LS.loadUser();
        if (cached) setCurrentUser(cached);
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  // ── Persiste o token em cookie HttpOnly após autenticação ─────────────────
  const persistTokenCookie = async (newToken: string) => {
    try {
      await fetch('/api/auth/me', {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${newToken}` },
      });
    } catch {
      // Falha silenciosa — sessão funcionará apenas até fechar a aba
      console.warn('[useAuth] Não foi possível persistir a sessão em cookie.');
    }
  };

  // ── Login ──────────────────────────────────────────────────────────────────
  const login = async (email: string, password: string) => {
    const data = await apiPost<{ user: User; token: string }>(
      '/api/auth/login',
      { email, password }
    );
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    await persistTokenCookie(data.token);
    return data.user;
  };

  // ── Register ──────────────────────────────────────────────────────────────
  const register = async (name: string, email: string, password: string) => {
    const data = await apiPost<{ user: User; token: string }>(
      '/api/auth/register',
      { name: name.trim(), email, password }
    );
    setToken(data.token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    await persistTokenCookie(data.token);
    return data.user;
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = async () => {
    // 1. Invalida o token na blacklist do servidor
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => {});
    }

    // 2. Apaga o cookie de sessão
    fetch('/api/auth/me', {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {});

    // 3. Limpa estado local
    LS.clearUser();
    setCurrentUser(null);
    setToken(null);
  };

  // ── Recuperação de senha ──────────────────────────────────────────────────
  const recoverPassword = async (email: string) => {
    return apiPost<{ message: string }>('/api/auth/recover', { email });
  };

  // ── Atualização de perfil ─────────────────────────────────────────────────
  const updateProfile = async (payload: {
    name?: string;
    email?: string;
    password?: string;
    avatar?: string | null;
  }) => {
    if (!token) throw new Error('Não autenticado');
    const data = await apiPut<{ user: User }>('/api/auth/profile', payload, token);
    setCurrentUser(data.user);
    LS.saveUser(data.user);
    return data.user;
  };

  return {
    currentUser,
    token,
    restoring, // use para exibir loading enquanto a sessão é restaurada
    login,
    register,
    logout,
    recoverPassword,
    updateProfile,
  };
}
