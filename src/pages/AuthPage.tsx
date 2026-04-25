import React, { useEffect, useState } from 'react';
import { Lock, Mail, Target, User as UserIcon } from 'lucide-react';
import type { useAuth } from '../hooks/useAuth';
import { LS } from '../lib/storage';

interface AuthPageProps {
  auth: ReturnType<typeof useAuth>;
  toastNotify: (title: string, msg: string) => void;
}

export function AuthPage({ auth, toastNotify }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverSuccess, setRecoverSuccess] = useState(false);

  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [rememberEmail, setRememberEmail] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    const rememberedEmail = LS.loadRememberedEmail();
    if (!rememberedEmail) return;

    setAuthEmail(rememberedEmail);
    setRecoverEmail(rememberedEmail);
    setRememberEmail(true);
  }, []);

  useEffect(() => {
    if (!isLogin) return;

    if (!rememberEmail) {
      LS.clearRememberedEmail();
      return;
    }

    const normalizedEmail = authEmail.trim();
    if (normalizedEmail) {
      LS.saveRememberedEmail(normalizedEmail);
    }
  }, [authEmail, isLogin, rememberEmail]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      const normalizedEmail = authEmail.trim();
      const user = isLogin
        ? await auth.login(normalizedEmail, authPassword)
        : await auth.register(authName, normalizedEmail, authPassword);

      toastNotify('Bem-vindo!', `Ola, ${user.name}!`);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Falha na comunicacao com o servidor.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      await auth.recoverPassword(recoverEmail.trim());
      setRecoverSuccess(true);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Erro ao recuperar senha.');
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-[#040814]">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl dark:border-white/10 dark:bg-[#0a122a]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/20">
            <Target size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Lembreto</h1>
          <p className="mt-2 text-sm text-slate-500">
            {isRecovering
              ? recoverSuccess ? 'E-mail enviado!' : 'Recuperar senha'
              : isLogin ? 'Faca login para continuar' : 'Crie sua conta'}
          </p>
        </div>

        {isRecovering ? (
          recoverSuccess ? (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/10">
                  <Mail size={28} className="text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <div>
                <h3 className="mb-2 font-bold text-slate-800 dark:text-slate-100">
                  Verifique seu e-mail
                </h3>
                <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  Se{' '}
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {recoverEmail}
                  </span>{' '}
                  estiver cadastrado, voce recebera um link em breve.
                </p>
              </div>
              <button
                onClick={() => {
                  setIsRecovering(false);
                  setRecoverSuccess(false);
                  setRecoverEmail(LS.loadRememberedEmail() || authEmail);
                  setAuthError('');
                }}
                className="w-full rounded-2xl bg-blue-600 py-3.5 font-bold text-white transition-all hover:bg-blue-700 active:scale-95"
              >
                Voltar ao Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleRecover} className="space-y-4">
              <p className="text-center text-sm text-slate-500">
                Informe seu e-mail para recuperar sua senha.
              </p>
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  required
                  type="email"
                  data-testid="recover-email-input"
                  placeholder="Seu email"
                  value={recoverEmail}
                  onChange={(e) => setRecoverEmail(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-white/10 dark:bg-[#0f172a] dark:text-white"
                />
              </div>
              {authError && <p className="text-center text-sm font-medium text-rose-500">{authError}</p>}
              <button
                type="submit"
                data-testid="recover-submit-button"
                disabled={authLoading}
                className="w-full rounded-2xl bg-blue-600 py-3.5 font-bold text-white transition-all hover:bg-blue-700 disabled:opacity-60 active:scale-95"
              >
                {authLoading ? 'Enviando...' : 'Recuperar Senha'}
              </button>
              <p className="text-center text-sm">
                <button
                  type="button"
                  data-testid="recover-back-button"
                  onClick={() => {
                    setIsRecovering(false);
                    setAuthError('');
                  }}
                  className="font-semibold text-blue-600 hover:underline"
                >
                  Voltar ao login
                </button>
              </p>
            </form>
          )
        ) : (
          <form onSubmit={handleAuth} className="space-y-4">
            {!isLogin && (
              <div className="relative">
                <UserIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  required
                  type="text"
                  data-testid="register-name-input"
                  placeholder="Seu nome completo"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-white/10 dark:bg-[#0f172a] dark:text-white"
                />
              </div>
            )}

            <div className="relative">
              <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                required
                type="email"
                data-testid="auth-email-input"
                placeholder="Email"
                value={authEmail}
                onChange={(e) => {
                  setAuthEmail(e.target.value);
                  if (!recoverEmail) {
                    setRecoverEmail(e.target.value);
                  }
                }}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-white/10 dark:bg-[#0f172a] dark:text-white"
              />
            </div>

            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                required
                type="password"
                data-testid="auth-password-input"
                placeholder="Senha"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-white/10 dark:bg-[#0f172a] dark:text-white"
              />
            </div>

            {isLogin && (
              <div className="flex items-center justify-between gap-4">
                <label
                  htmlFor="remember-email"
                  className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"
                >
                  <input
                    id="remember-email"
                    type="checkbox"
                    data-testid="remember-email-checkbox"
                    checked={rememberEmail}
                    onChange={(e) => setRememberEmail(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Lembrar meu e-mail
                </label>
                <button
                  type="button"
                  data-testid="forgot-password-button"
                  onClick={() => {
                    setIsRecovering(true);
                    setRecoverEmail(authEmail || LS.loadRememberedEmail());
                    setAuthError('');
                  }}
                  className="text-sm font-semibold text-blue-600 hover:underline"
                >
                  Esqueceu a senha?
                </button>
              </div>
            )}

            {authError && <p className="text-center text-sm font-medium text-rose-500">{authError}</p>}

            <button
              type="submit"
              data-testid="auth-submit-button"
              disabled={authLoading}
              className="w-full rounded-2xl bg-blue-600 py-3.5 font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-700 disabled:opacity-60 active:scale-95"
            >
              {authLoading ? 'Aguarde...' : isLogin ? 'Entrar' : 'Criar Conta'}
            </button>

            <p className="text-center text-sm text-slate-500">
              {isLogin ? 'Nao tem uma conta?' : 'Ja possui uma conta?'}{' '}
              <button
                type="button"
                data-testid="auth-mode-toggle"
                onClick={() => {
                  setIsLogin((value) => !value);
                  setAuthError('');
                }}
                className="font-bold text-blue-600 hover:underline"
              >
                {isLogin ? 'Registre-se' : 'Faca login'}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
