import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import type { useAuth } from '../hooks/useAuth';
import { resolveApiUrl } from '../api/client';
import { LS } from '../lib/storage';
import { RecaptchaCheckbox } from '../components/RecaptchaCheckbox';
import { BrandMark } from '../components/BrandLogo';

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
      helper: 'Boa combinacao de tamanho e variedade de caracteres.',
    };
  }

  if (score >= 3) {
    return {
      level: 'medium',
      label: 'Senha media',
      width: '68%',
      tone: 'bg-amber-500',
      helper: 'Ja esta melhor. Vale adicionar mais variedade para ficar mais segura.',
    };
  }

  return {
    level: 'weak',
    label: 'Senha fraca',
    width: '34%',
    tone: 'bg-rose-500',
    helper: 'Use pelo menos 8 caracteres com letras maiusculas, numeros e simbolos.',
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
          <p className="font-semibold">Verificacao de seguranca indisponivel</p>
          <p className="mt-1 leading-6">
            Atualize a pagina e tente novamente. Se continuar assim, a chave publica do reCAPTCHA precisa ser configurada no ambiente.
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
  const [showAuthPassword, setShowAuthPassword] = useState(false);
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

    fetch(resolveApiUrl('/api/auth/config'), { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Configuracao de autenticacao indisponivel');
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
      setAuthError('A verificacao de seguranca nao esta disponivel. Atualize a pagina e tente novamente.');
      return false;
    }
    if (!recaptchaEnabled || recaptchaToken) return true;
    if (recaptchaUnavailable) {
      setAuthError('Nao foi possivel carregar o reCAPTCHA. Atualize a pagina e tente novamente.');
      return false;
    }
    setAuthError('Confirme que voce nao e um robo.');
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

      toastNotify('Bem-vindo!', `Ola, ${user.name}!`);
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Falha na comunicacao com o servidor.');
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

  const switchMode = (nextIsLogin: boolean) => {
    setIsLogin(nextIsLogin);
    setIsRecovering(false);
    setRecoverSuccess(false);
    setAuthError('');
    resetRecaptcha();
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-slate-50 px-4 py-8 text-slate-950 dark:bg-slate-950 dark:text-white sm:px-6">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.12),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(20,184,166,0.12),transparent_28%),radial-gradient(circle_at_50%_90%,rgba(124,58,237,0.08),transparent_36%)]" />

      <main className="relative grid w-full max-w-6xl overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_34px_90px_-52px_rgba(15,23,42,0.5)] dark:border-white/10 dark:bg-slate-900 lg:grid-cols-[0.92fr_1fr]">
        <section className="hidden flex-col justify-between border-r border-slate-200 bg-slate-950 p-10 text-white dark:border-white/10 lg:flex">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-white shadow-[0_18px_40px_-22px_rgba(14,165,233,0.8)]">
                <BrandMark className="h-10 w-10" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Sistema</p>
                <h1 className="text-2xl font-semibold">Lembreto</h1>
              </div>
            </div>

            <div className="mt-14 max-w-md">
              <p className="inline-flex rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-cyan-100">
                Acesso direto
              </p>
              <h2 className="mt-5 text-4xl font-semibold leading-tight">
                Entre no painel para organizar lembretes, notas e alarmes.
              </h2>
              <p className="mt-5 text-sm leading-7 text-slate-400">
                Esta e a entrada do sistema. A landing agora fica isolada e nao interfere no aplicativo desktop.
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            {[
              'Dashboard, agenda e lembretes no primeiro acesso.',
              'Login, cadastro, Google e recuperacao de senha.',
              'Sessao preparada para web, mobile e desktop.',
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200">
                <CheckCircle2 size={17} className="text-emerald-300" />
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="flex min-h-[680px] items-center justify-center p-5 sm:p-8 lg:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-950 shadow-[0_18px_40px_-24px_rgba(37,99,235,0.8)] dark:bg-white">
                <BrandMark className="h-11 w-11" />
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase text-slate-500 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300">
                {isRecovering ? 'Acesso' : isLogin ? 'Entrar' : 'Criar conta'}
              </span>
              <h2 className="mt-4 text-3xl font-semibold text-slate-950 dark:text-white">
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
                    ? 'Se o endereco estiver cadastrado, voce recebera um link de recuperacao em instantes.'
                    : 'Informe o e-mail da conta para iniciar a recuperacao.'
                  : isLogin
                    ? 'Faca login para abrir seu painel.'
                    : 'Comece a organizar sua rotina em poucos minutos.'}
              </p>
            </div>

            {isRecovering ? (
              recoverSuccess ? (
                <div className="space-y-6 rounded-[24px] border border-slate-200 bg-slate-50 p-6 text-center dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                    <Mail size={28} />
                  </div>
                  <p className="text-sm leading-7 text-slate-500 dark:text-slate-400">
                    Se <span className="font-semibold text-slate-900 dark:text-slate-200">{recoverEmail}</span> estiver cadastrado, voce recebera um link em breve.
                  </p>
                  <button
                    type="button"
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
                  <div className="space-y-4 rounded-[24px] border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.04] sm:p-6">
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
                <div className="space-y-4 rounded-[24px] border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.04] sm:p-6">
                  <div className="grid grid-cols-2 rounded-2xl bg-slate-200/70 p-1 dark:bg-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => switchMode(true)}
                      className={[
                        'min-w-0 rounded-2xl px-2 py-3 text-sm font-semibold transition-colors sm:px-4',
                        isLogin
                          ? 'bg-white text-slate-950 shadow-sm dark:bg-white dark:text-slate-950'
                          : 'text-slate-500 dark:text-slate-400',
                      ].join(' ')}
                    >
                      Entrar
                    </button>
                    <button
                      type="button"
                      data-testid="auth-mode-toggle"
                      onClick={() => switchMode(false)}
                      className={[
                        'min-w-0 rounded-2xl px-2 py-3 text-sm font-semibold transition-colors sm:px-4',
                        !isLogin
                          ? 'bg-white text-slate-950 shadow-sm dark:bg-white dark:text-slate-950'
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
                      type={showAuthPassword ? 'text' : 'password'}
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      data-testid="auth-password-input"
                      placeholder="Senha"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      className="field-control field-control-with-icon pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAuthPassword((current) => !current)}
                      aria-label={showAuthPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:bg-white/[0.08] dark:hover:text-white"
                    >
                      {showAuthPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>

                  {!isLogin && authPassword.trim().length > 0 && (
                    <div data-testid="password-strength-indicator" className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/50">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <p className="text-sm font-semibold text-slate-950 dark:text-white">
                          {passwordStrength.label}
                        </p>
                        <span className="text-xs font-medium text-slate-500">
                          Seguranca da senha
                        </span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
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
                        className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-all hover:-translate-y-0.5 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:bg-white/[0.08]"
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
                  {isLogin ? 'Ainda nao tem uma conta?' : 'Ja possui uma conta?'}{' '}
                  <button
                    type="button"
                    onClick={() => switchMode(!isLogin)}
                    className="font-semibold text-blue-600 hover:underline dark:text-blue-300"
                  >
                    {isLogin ? 'Criar conta' : 'Fazer login'}
                  </button>
                </p>
              </form>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
