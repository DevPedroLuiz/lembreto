import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Mail, ShieldCheck, Target, User as UserIcon } from 'lucide-react';
import type { useAuth } from '../hooks/useAuth';
import { LS } from '../lib/storage';
import { RecaptchaCheckbox } from '../components/RecaptchaCheckbox';

interface AuthPageProps {
  auth: ReturnType<typeof useAuth>;
  toastNotify: (title: string, message: string) => void;
}

type PasswordStrength = 'weak' | 'medium' | 'strong';

interface AuthConfig {
  recaptchaRequired?: boolean;
  recaptchaSiteKey?: string | null;
}

function getPasswordStrength(password: string): {
  level: PasswordStrength;
  label: string;
  width: string;
  tone: string;
  helper: string;
} {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score >= 5) {
    return {
      level: 'strong',
      label: 'Senha forte',
      width: '100%',
      tone: 'bg-emerald-500',
      helper: 'Boa combinação de tamanho e variedade de caracteres.',
    };
  }

  if (score >= 3) {
    return {
      level: 'medium',
      label: 'Senha média',
      width: '68%',
      tone: 'bg-amber-500',
      helper: 'Já está melhor. Vale adicionar mais variedade para ficar mais segura.',
    };
  }

  return {
    level: 'weak',
    label: 'Senha fraca',
    width: '34%',
    tone: 'bg-rose-500',
    helper: 'Use pelo menos 8 caracteres com letras maiúsculas, números e símbolos.',
  };
}

function SecurityVerificationUnavailable() {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
          <ShieldCheck size={17} />
        </div>
        <div>
          <p className="font-semibold">Verificação de segurança indisponível</p>
          <p className="mt-1 leading-6">
            Atualize a página e tente novamente. Se continuar assim, a chave pública do reCAPTCHA precisa ser configurada no ambiente.
          </p>
        </div>
      </div>
    </div>
  );
}

export function AuthPage({ auth, toastNotify }: AuthPageProps) {
  const configuredRecaptchaSiteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined)?.trim() ?? '';
  const recaptchaDisabledForTest = import.meta.env.VITE_DISABLE_RECAPTCHA === 'true';
  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState(configuredRecaptchaSiteKey);
  const [recaptchaRequired, setRecaptchaRequired] = useState(Boolean(import.meta.env.PROD));
  const recaptchaEnabled = Boolean(recaptchaSiteKey) && !recaptchaDisabledForTest;
  const recaptchaMissingRequired = recaptchaRequired && !recaptchaEnabled && !recaptchaDisabledForTest;
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
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [recaptchaResetKey, setRecaptchaResetKey] = useState(0);
  const [recaptchaUnavailable, setRecaptchaUnavailable] = useState(false);

  const passwordStrength = useMemo(
    () => getPasswordStrength(authPassword),
    [authPassword],
  );

  useEffect(() => {
    const rememberedEmail = LS.loadRememberedEmail();
    if (!rememberedEmail) return;

    setAuthEmail(rememberedEmail);
    setRecoverEmail(rememberedEmail);
    setRememberEmail(true);
  }, []);

  useEffect(() => {
    if (recaptchaDisabledForTest) return;

    let cancelled = false;

    fetch('/api/auth/config', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Configuração de autenticação indisponível');
        return response.json() as Promise<AuthConfig>;
      })
      .then((config) => {
        if (cancelled) return;

        const runtimeSiteKey = config.recaptchaSiteKey?.trim();
        if (!configuredRecaptchaSiteKey && runtimeSiteKey) {
          setRecaptchaSiteKey(runtimeSiteKey);
        }
        setRecaptchaRequired(Boolean(config.recaptchaRequired));
      })
      .catch(() => {
        if (cancelled) return;
        setRecaptchaRequired(Boolean(import.meta.env.PROD));
      });

    return () => {
      cancelled = true;
    };
  }, [configuredRecaptchaSiteKey, recaptchaDisabledForTest]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleError = params.get('auth_error');
    if (!googleError) return;

    setAuthError(googleError);
    params.delete('auth_error');
    const nextSearch = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
    );
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

  const resetRecaptcha = useCallback(() => {
    setRecaptchaToken('');
    setRecaptchaUnavailable(false);
    setRecaptchaResetKey((value) => value + 1);
  }, []);

  const handleRecaptchaUnavailable = useCallback(() => {
    setRecaptchaUnavailable(true);
  }, []);

  const validateRecaptcha = useCallback(() => {
    if (recaptchaMissingRequired) {
      setAuthError('A verificação de segurança não está disponível. Atualize a página e tente novamente.');
      return false;
    }
    if (!recaptchaEnabled || recaptchaToken) return true;
    if (recaptchaUnavailable) {
      setAuthError('Não foi possível carregar o reCAPTCHA. Atualize a página e tente novamente.');
      return false;
    }
    setAuthError('Confirme que você não é um robô.');
    return false;
  }, [recaptchaEnabled, recaptchaMissingRequired, recaptchaToken, recaptchaUnavailable]);

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');

    if (!validateRecaptcha()) return;

    setAuthLoading(true);

    try {
      const normalizedEmail = authEmail.trim();
      const user = isLogin
        ? await auth.login(normalizedEmail, authPassword, recaptchaToken)
        : await auth.register(authName, normalizedEmail, authPassword, recaptchaToken);

      toastNotify('Bem-vindo!', `Olá, ${user.name}!`);
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Falha na comunicação com o servidor.');
      resetRecaptcha();
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRecover = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');

    if (!validateRecaptcha()) return;

    setAuthLoading(true);

    try {
      await auth.recoverPassword(recoverEmail.trim(), recaptchaToken);
      setRecoverSuccess(true);
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Erro ao recuperar a senha.');
      resetRecaptcha();
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
                      resetRecaptcha();
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

                    {recaptchaMissingRequired ? (
                      <SecurityVerificationUnavailable />
                    ) : (
                      <RecaptchaCheckbox
                        siteKey={recaptchaEnabled ? recaptchaSiteKey : undefined}
                        resetKey={recaptchaResetKey}
                        onChange={setRecaptchaToken}
                        onUnavailable={handleRecaptchaUnavailable}
                      />
                    )}

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
                        resetRecaptcha();
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
                        resetRecaptcha();
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
                        resetRecaptcha();
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

                  {!isLogin && authPassword.trim().length > 0 && (
                    <div data-testid="password-strength-indicator" className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {passwordStrength.label}
                        </p>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Segurança da senha
                        </span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div
                          className={`h-full rounded-full transition-all ${passwordStrength.tone}`}
                          style={{ width: passwordStrength.width }}
                        />
                      </div>
                      <p className="mt-3 text-xs leading-6 text-slate-500 dark:text-slate-400">
                        {passwordStrength.helper}
                      </p>
                    </div>
                  )}

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
                          resetRecaptcha();
                        }}
                        className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-300"
                      >
                        Esqueceu a senha?
                      </button>
                    </div>
                  )}

                  {recaptchaMissingRequired ? (
                    <SecurityVerificationUnavailable />
                  ) : (
                    <RecaptchaCheckbox
                      siteKey={recaptchaEnabled ? recaptchaSiteKey : undefined}
                      resetKey={recaptchaResetKey}
                      onChange={setRecaptchaToken}
                      onUnavailable={handleRecaptchaUnavailable}
                    />
                  )}

                  {authError && (
                    <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                      {authError}
                    </p>
                  )}

                  {isLogin && (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                        <span className="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">
                          ou
                        </span>
                        <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                      </div>

                      <button
                        type="button"
                        data-testid="google-login-button"
                        disabled={authLoading}
                        onClick={() => {
                          setAuthError('');
                          setAuthLoading(true);
                          auth.loginWithGoogle();
                        }}
                        className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:bg-white/[0.08]"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-base font-bold text-blue-600 shadow-sm">
                          G
                        </span>
                        Entrar com Google
                      </button>
                    </>
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
                      resetRecaptcha();
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
