import React, { useEffect, useState } from 'react';
import { Lock, Mail, ShieldCheck, Target, User as UserIcon } from 'lucide-react';
import type { useAuth } from '../hooks/useAuth';
import { LS } from '../lib/storage';

interface AuthPageProps {
  auth: ReturnType<typeof useAuth>;
  toastNotify: (title: string, message: string) => void;
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

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      const normalizedEmail = authEmail.trim();
      const user = isLogin
        ? await auth.login(normalizedEmail, authPassword)
        : await auth.register(authName, normalizedEmail, authPassword);

      toastNotify('Bem-vindo!', `Olá, ${user.name}!`);
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Falha na comunicação com o servidor.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRecover = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      await auth.recoverPassword(recoverEmail.trim());
      setRecoverSuccess(true);
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Erro ao recuperar a senha.');
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
      <div className="absolute inset-0 bg-grid opacity-50 dark:opacity-30" />

      <div className="relative grid w-full max-w-6xl overflow-hidden rounded-[36px] border border-slate-200/80 bg-white/90 shadow-[0_40px_120px_-40px_rgba(15,23,42,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/78 dark:shadow-[0_40px_120px_-48px_rgba(0,0,0,0.85)] lg:grid-cols-[1.1fr_0.9fr]">
        <aside className="hidden border-r border-slate-200/80 bg-slate-50/80 p-10 dark:border-white/10 dark:bg-white/[0.04] lg:flex lg:flex-col">
          <div>
            <span className="section-eyebrow">
              <ShieldCheck size={14} />
              Organização com clareza
            </span>
            <div className="mt-6 flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_18px_36px_-22px_rgba(37,99,235,0.65)]">
                <Target size={28} />
              </div>
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                  Lembreto
                </h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Sua rotina em um só lugar.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-12 space-y-6">
            <div className="surface-soft p-5">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Planeje, acompanhe e conclua com menos atrito.
              </h2>
              <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
                Organize lembretes por prioridade, categoria e prazo em uma interface limpa, rápida e confortável de usar.
              </p>
            </div>

            <div className="grid gap-4">
              {[
                'Visão clara das prioridades do dia.',
                'Acompanhamento de lembretes pendentes e concluídos.',
                'Recuperação de acesso e preferências salvas no navegador.',
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/85 px-4 py-4 dark:border-white/10 dark:bg-white/[0.04]"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                    <ShieldCheck size={16} />
                  </div>
                  <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="p-6 sm:p-8 lg:p-10">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-8 text-center lg:text-left">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_18px_36px_-22px_rgba(37,99,235,0.65)] lg:mx-0 lg:hidden">
                <Target size={28} />
              </div>
              <span className="section-eyebrow">
                {isRecovering ? 'Acesso' : isLogin ? 'Entrar' : 'Criar conta'}
              </span>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                {isRecovering
                  ? recoverSuccess
                    ? 'Verifique seu e-mail'
                    : 'Recuperar senha'
                  : isLogin
                    ? 'Bem-vindo de volta'
                    : 'Crie sua conta'}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {isRecovering
                  ? recoverSuccess
                    ? 'Se o endereço estiver cadastrado, você receberá um link de recuperação em instantes.'
                    : 'Informe o e-mail da conta para iniciar a recuperação.'
                  : isLogin
                    ? 'Faça login para continuar seu planejamento.'
                    : 'Comece a organizar sua rotina em poucos minutos.'}
              </p>
            </div>

            {isRecovering ? (
              recoverSuccess ? (
                <div className="surface-soft space-y-6 p-6 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <Mail size={28} />
                  </div>

                  <div>
                    <p className="text-sm leading-7 text-slate-500 dark:text-slate-400">
                      Se <span className="font-semibold text-slate-800 dark:text-slate-200">{recoverEmail}</span> estiver cadastrado, você receberá um link em breve.
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setIsRecovering(false);
                      setRecoverSuccess(false);
                      setRecoverEmail(LS.loadRememberedEmail() || authEmail);
                      setAuthError('');
                    }}
                    className="action-primary w-full"
                  >
                    Voltar para o login
                  </button>
                </div>
              ) : (
                <form onSubmit={handleRecover} className="space-y-4">
                  <div className="surface-soft space-y-4 p-6">
                    <div className="relative">
                      <Mail size={18} className="field-icon" />
                      <input
                        required
                        type="email"
                        autoComplete="email"
                        data-testid="recover-email-input"
                        placeholder="Seu e-mail"
                        value={recoverEmail}
                        onChange={(event) => setRecoverEmail(event.target.value)}
                        className="field-control field-control-with-icon"
                      />
                    </div>

                    {authError && (
                      <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                        {authError}
                      </p>
                    )}

                    <button
                      type="submit"
                      data-testid="recover-submit-button"
                      disabled={authLoading}
                      className="action-primary w-full disabled:cursor-wait disabled:opacity-60"
                    >
                      {authLoading ? 'Enviando...' : 'Recuperar senha'}
                    </button>
                  </div>

                  <p className="text-center text-sm">
                    <button
                      type="button"
                      data-testid="recover-back-button"
                      onClick={() => {
                        setIsRecovering(false);
                        setAuthError('');
                      }}
                      className="font-semibold text-blue-600 hover:underline dark:text-blue-300"
                    >
                      Voltar para o login
                    </button>
                  </p>
                </form>
              )
            ) : (
              <form onSubmit={handleAuth} className="space-y-4">
                <div className="surface-soft space-y-4 p-6">
                  <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1 dark:bg-white/[0.05]">
                    <button
                      type="button"
                      onClick={() => {
                        setIsLogin(true);
                        setAuthError('');
                      }}
                      className={[
                        'rounded-2xl px-4 py-3 text-sm font-semibold transition-colors',
                        isLogin
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400',
                      ].join(' ')}
                    >
                      Entrar
                    </button>
                    <button
                      type="button"
                      data-testid="auth-mode-toggle"
                      onClick={() => {
                        setIsLogin(false);
                        setAuthError('');
                      }}
                      className={[
                        'rounded-2xl px-4 py-3 text-sm font-semibold transition-colors',
                        !isLogin
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400',
                      ].join(' ')}
                    >
                      Criar conta
                    </button>
                  </div>

                  {!isLogin && (
                    <div className="relative">
                      <UserIcon size={18} className="field-icon" />
                      <input
                        required
                        type="text"
                        autoComplete="name"
                        data-testid="register-name-input"
                        placeholder="Seu nome completo"
                        value={authName}
                        onChange={(event) => setAuthName(event.target.value)}
                        className="field-control field-control-with-icon"
                      />
                    </div>
                  )}

                  <div className="relative">
                    <Mail size={18} className="field-icon" />
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      data-testid="auth-email-input"
                      placeholder="E-mail"
                      value={authEmail}
                      onChange={(event) => {
                        setAuthEmail(event.target.value);
                        if (!recoverEmail) setRecoverEmail(event.target.value);
                      }}
                      className="field-control field-control-with-icon"
                    />
                  </div>

                  <div className="relative">
                    <Lock size={18} className="field-icon" />
                    <input
                      required
                      type="password"
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      data-testid="auth-password-input"
                      placeholder="Senha"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      className="field-control field-control-with-icon"
                    />
                  </div>

                  {isLogin && (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label
                        htmlFor="remember-email"
                        className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"
                      >
                        <input
                          id="remember-email"
                          type="checkbox"
                          data-testid="remember-email-checkbox"
                          checked={rememberEmail}
                          onChange={(event) => setRememberEmail(event.target.checked)}
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
                        className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-300"
                      >
                        Esqueceu a senha?
                      </button>
                    </div>
                  )}

                  {authError && (
                    <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                      {authError}
                    </p>
                  )}

                  <button
                    type="submit"
                    data-testid="auth-submit-button"
                    disabled={authLoading}
                    className="action-primary w-full disabled:cursor-wait disabled:opacity-60"
                  >
                    {authLoading ? 'Aguarde...' : isLogin ? 'Entrar' : 'Criar conta'}
                  </button>
                </div>

                <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                  {isLogin ? 'Ainda não tem uma conta?' : 'Já possui uma conta?'}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogin((value) => !value);
                      setAuthError('');
                    }}
                    className="font-semibold text-blue-600 hover:underline dark:text-blue-300"
                  >
                    {isLogin ? 'Criar conta' : 'Fazer login'}
                  </button>
                </p>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
