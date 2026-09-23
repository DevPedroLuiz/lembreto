import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
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
      helper: 'Excelente combinação de caracteres para máxima proteção.',
    };
  }

  if (score >= 3) {
    return {
      level: 'medium',
      label: 'Senha média',
      width: '68%',
      tone: 'bg-amber-500',
      helper: 'Adicione símbolos ou números para reforçar ainda mais a segurança.',
    };
  }

  return {
    level: 'weak',
    label: 'Senha fraca',
    width: '34%',
    tone: 'bg-rose-500',
    helper: 'Use ao menos 8 caracteres misturando letras, números e símbolos.',
  };
}

function isPlaceholderKey(key?: string | null): boolean {
  if (!key) return true;
  const trimmed = key.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith('your_') ||
    trimmed.includes('placeholder')
  );
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
            Atualize a página e tente novamente. Se o problema persistir, entre em contato com o suporte.
          </p>
        </div>
      </div>
    </div>
  );
}

export function AuthPage({ auth, toastNotify }: AuthPageProps) {
  const configuredRecaptchaSiteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined)?.trim() ?? '';
  const recaptchaDisabledForTest = import.meta.env.VITE_DISABLE_RECAPTCHA === 'true';

  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState(
    isPlaceholderKey(configuredRecaptchaSiteKey) ? '' : configuredRecaptchaSiteKey
  );
  const [recaptchaRequired, setRecaptchaRequired] = useState(false);
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
        if (!response.ok) throw new Error('Configuração de autenticação indisponível');
        return response.json() as Promise<AuthConfig>;
      })
      .then((config) => {
        if (cancelled) return;

        const runtimeSiteKey = config.recaptchaSiteKey?.trim();
        if (!isPlaceholderKey(runtimeSiteKey)) {
          setRecaptchaSiteKey(runtimeSiteKey ?? '');
        } else {
          setRecaptchaSiteKey('');
        }
        setRecaptchaRequired(Boolean(config.recaptchaRequired));
      })
      .catch(() => {
        if (cancelled) return;
        setRecaptchaRequired(false);
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
      setAuthError('Não foi possível carregar a validação de segurança. Atualize a página e tente novamente.');
      return false;
    }
    setAuthError('Por favor, confirme a validação de segurança.');
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

  const switchMode = (nextIsLogin: boolean) => {
    setIsLogin(nextIsLogin);
    setIsRecovering(false);
    setRecoverSuccess(false);
    setAuthError('');
    resetRecaptcha();
  };

  return (
    <div className="relative flex h-full min-h-[100dvh] w-full flex-col overflow-y-auto bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-white lg:h-screen lg:overflow-hidden">
      {/* Background ambient lighting */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_left,rgba(37,99,235,0.14),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(16,185,129,0.12),transparent_45%),radial-gradient(circle_at_50%_50%,rgba(147,51,234,0.06),transparent_55%)]" />

      <main className="relative z-10 grid h-full min-h-[100dvh] w-full flex-1 lg:min-h-0 lg:grid-cols-12">
        {/* Left Column: Expansive System Branding & Visual Showcase (Desktop) */}
        <section className="relative hidden h-full flex-col justify-between overflow-hidden border-r border-slate-200/80 bg-slate-950 p-8 text-white dark:border-white/10 dark:bg-slate-900/95 lg:col-span-5 lg:flex xl:col-span-5 xl:p-12 2xl:col-span-5 2xl:p-16">
          {/* Subtle tech background accents */}
          <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-blue-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl" />

          {/* Brand Header */}
          <div className="relative z-10 flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-950 shadow-[0_12px_32px_-12px_rgba(14,165,233,0.8)] transition-transform hover:scale-105">
              <BrandMark className="h-8 w-8" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Sistema</p>
              <h1 className="text-xl font-bold tracking-tight">Lembreto</h1>
            </div>
          </div>

          {/* Hero Content & Previews */}
          <div className="relative z-10 max-w-lg space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3.5 py-1 text-xs font-semibold text-cyan-300 backdrop-blur-md">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
              Acesso direto ao painel
            </div>

            <h2 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl 2xl:text-5xl">
              Entre no painel para organizar lembretes, notas e alarmes.
            </h2>

            <p className="text-sm leading-relaxed text-slate-400 xl:text-base">
              Gerencie seus compromissos diários, tarefas urgentes e rotinas com facilidade. Sessão integrada para web, mobile e desktop.
            </p>

            {/* Expansive feature showcase cards */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur-md transition-all hover:bg-white/[0.07]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-300">
                    <BellRing size={19} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">Reunião de Planejamento</p>
                    <p className="text-[11px] text-slate-400">Hoje às 14:30 • Alarme com pré-aviso</p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                  Agendado
                </span>
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur-md transition-all hover:bg-white/[0.07]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
                    <Calendar size={19} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">Revisão de Prazos e Tarefas</p>
                    <p className="text-[11px] text-slate-400">Sincronizado com o calendário</p>
                  </div>
                </div>
                <span className="rounded-full bg-blue-500/20 px-2.5 py-0.5 text-[10px] font-bold text-blue-300">
                  Prioridade Alta
                </span>
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur-md transition-all hover:bg-white/[0.07]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                    <Clock size={19} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">Notas Rápidas & Anotações</p>
                    <p className="text-[11px] text-slate-400">Fixadas e organizadas por tags</p>
                  </div>
                </div>
                <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-bold text-amber-300">
                  Disponível
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Highlights */}
          <div className="relative z-10 space-y-2.5 border-t border-white/10 pt-5">
            {[
              'Dashboard, agenda e lembretes no primeiro acesso.',
              'Login, cadastro, Google e recuperação de senha.',
              'Sessão preparada para web, mobile e desktop.',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5 text-xs font-medium text-slate-300 xl:text-sm">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <CheckCircle2 size={13} />
                </div>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Right Column: Fluid, Expansive Form Container */}
        <section className="col-span-12 flex h-full flex-col justify-between overflow-y-auto px-4 py-8 sm:px-8 lg:col-span-7 lg:px-12 xl:col-span-7 xl:px-16 2xl:col-span-7 2xl:px-20">
          <div className="mx-auto my-auto w-full max-w-lg pb-8 pt-4">
            {/* Mobile / Tablet Logo Header */}
            <div className="mb-6 flex items-center justify-center gap-3 lg:hidden">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-md dark:bg-white dark:text-slate-950">
                <BrandMark className="h-7 w-7" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sistema</p>
                <h1 className="text-xl font-bold">Lembreto</h1>
              </div>
            </div>

            {/* Form Title & Context */}
            <div className="text-center sm:text-left">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100/80 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300">
                <Sparkles size={13} className="text-blue-500 dark:text-blue-400" />
                {isRecovering ? 'Recuperação de Acesso' : isLogin ? 'Acesso ao Sistema' : 'Nova Conta'}
              </span>

              <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                {isRecovering
                  ? recoverSuccess
                    ? 'Verifique seu e-mail'
                    : 'Recuperar senha'
                  : isLogin
                    ? 'Bem-vindo de volta'
                    : 'Crie sua conta no Lembreto'}
              </h2>

              <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {isRecovering
                  ? recoverSuccess
                    ? 'Se o endereço estiver cadastrado, você receberá um link de recuperação em instantes.'
                    : 'Informe o e-mail da sua conta para enviarmos o link de recuperação.'
                  : isLogin
                    ? 'Faça login para abrir seu painel e organizar suas tarefas.'
                    : 'Comece a organizar sua rotina pessoal e profissional em poucos minutos.'}
              </p>
            </div>

            {/* Main Interactive Form Card */}
            <div className="mt-6 rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-xl shadow-slate-200/50 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/85 dark:shadow-none sm:p-8">
              {isRecovering ? (
                recoverSuccess ? (
                  <div className="space-y-6 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                      <Mail size={30} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                        Link de recuperação enviado!
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        Se <span className="font-semibold text-slate-900 dark:text-slate-200">{recoverEmail}</span> estiver cadastrado, verifique sua caixa de entrada e siga as instruções.
                      </p>
                    </div>
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
                  <form onSubmit={handleRecover} className="space-y-5">
                    <div className="relative">
                      <Mail size={18} className="field-icon" />
                      <input
                        required
                        type="email"
                        autoComplete="email"
                        data-testid="recover-email-input"
                        placeholder="Seu e-mail cadastrado"
                        value={recoverEmail}
                        onChange={(event) => setRecoverEmail(event.target.value)}
                        className="field-control field-control-with-icon"
                      />
                    </div>

                    {recaptchaMissingRequired ? (
                      <SecurityVerificationUnavailable />
                    ) : recaptchaEnabled ? (
                      <RecaptchaCheckbox
                        siteKey={recaptchaSiteKey}
                        resetKey={recaptchaResetKey}
                        onChange={setRecaptchaToken}
                        onUnavailable={handleRecaptchaUnavailable}
                      />
                    ) : null}

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
                      {authLoading ? 'Enviando link...' : 'Recuperar senha'}
                    </button>

                    <div className="pt-2 text-center">
                      <button
                        type="button"
                        data-testid="recover-back-button"
                        onClick={() => {
                          setIsRecovering(false);
                          setAuthError('');
                          resetRecaptcha();
                        }}
                        className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        ← Voltar para o login
                      </button>
                    </div>
                  </form>
                )
              ) : (
                <form onSubmit={handleAuth} className="space-y-5">
                  {/* Segmented Mode Switcher */}
                  <div className="grid grid-cols-2 rounded-2xl bg-slate-100 p-1.5 dark:bg-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => switchMode(true)}
                      className={[
                        'min-w-0 rounded-xl py-2.5 text-sm font-semibold transition-all sm:px-4',
                        isLogin
                          ? 'bg-white text-slate-950 shadow-sm dark:bg-white dark:text-slate-950'
                          : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                      ].join(' ')}
                    >
                      Entrar
                    </button>
                    <button
                      type="button"
                      data-testid="auth-mode-toggle"
                      onClick={() => switchMode(false)}
                      className={[
                        'min-w-0 rounded-xl py-2.5 text-sm font-semibold transition-all sm:px-4',
                        !isLogin
                          ? 'bg-white text-slate-950 shadow-sm dark:bg-white dark:text-slate-950'
                          : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                      ].join(' ')}
                    >
                      Criar conta
                    </button>
                  </div>

                  {/* Name field for registration */}
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

                  {/* Email field */}
                  <div className="relative">
                    <Mail size={18} className="field-icon" />
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      data-testid="auth-email-input"
                      placeholder="Seu e-mail"
                      value={authEmail}
                      onChange={(event) => {
                        setAuthEmail(event.target.value);
                        if (!recoverEmail) setRecoverEmail(event.target.value);
                      }}
                      className="field-control field-control-with-icon"
                    />
                  </div>

                  {/* Password field */}
                  <div className="relative">
                    <Lock size={18} className="field-icon" />
                    <input
                      required
                      type={showAuthPassword ? 'text' : 'password'}
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      data-testid="auth-password-input"
                      placeholder="Sua senha"
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

                  {/* Password strength meter in Register mode */}
                  {!isLogin && authPassword.trim().length > 0 && (
                    <div
                      data-testid="password-strength-indicator"
                      className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-slate-950/40"
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <p className="text-sm font-semibold text-slate-950 dark:text-white">
                          {passwordStrength.label}
                        </p>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          Segurança da senha
                        </span>
                      </div>
                      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${passwordStrength.tone}`}
                          style={{ width: passwordStrength.width }}
                        />
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {passwordStrength.helper}
                      </p>
                    </div>
                  )}

                  {/* Remember me and Forgot password (Login mode) */}
                  {isLogin && (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <label
                        htmlFor="remember-email"
                        className="inline-flex cursor-pointer items-center gap-2 text-slate-600 dark:text-slate-300"
                      >
                        <input
                          id="remember-email"
                          type="checkbox"
                          data-testid="remember-email-checkbox"
                          checked={rememberEmail}
                          onChange={(event) => setRememberEmail(event.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>Lembrar meu e-mail</span>
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
                        className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Esqueceu a senha?
                      </button>
                    </div>
                  )}

                  {/* reCAPTCHA check if enabled */}
                  {recaptchaMissingRequired ? (
                    <SecurityVerificationUnavailable />
                  ) : recaptchaEnabled ? (
                    <RecaptchaCheckbox
                      siteKey={recaptchaSiteKey}
                      resetKey={recaptchaResetKey}
                      onChange={setRecaptchaToken}
                      onUnavailable={handleRecaptchaUnavailable}
                    />
                  ) : null}

                  {/* Error display */}
                  {authError && (
                    <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                      {authError}
                    </p>
                  )}

                  {/* Google OAuth Button */}
                  {isLogin && (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
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
                        className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-all hover:-translate-y-0.5 hover:bg-slate-50 active:translate-y-0 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:hover:bg-white/[0.08]"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-base font-bold text-blue-600 shadow-sm">
                          G
                        </span>
                        Entrar com Google
                      </button>
                    </>
                  )}

                  {/* Submit Button */}
                  <button
                    type="submit"
                    data-testid="auth-submit-button"
                    disabled={authLoading}
                    className="action-primary w-full py-3.5 text-base font-semibold shadow-lg shadow-blue-500/20 disabled:cursor-wait disabled:opacity-60"
                  >
                    {authLoading ? 'Aguarde...' : isLogin ? 'Entrar no Lembreto' : 'Criar minha conta'}
                  </button>
                </form>
              )}
            </div>

            {/* Bottom Toggle Switcher Link */}
            {!isRecovering && (
              <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {isLogin ? 'Ainda não tem uma conta?' : 'Já possui uma conta?'}{' '}
                <button
                  type="button"
                  onClick={() => switchMode(!isLogin)}
                  className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  {isLogin ? 'Criar conta gratuitamente' : 'Fazer login'}
                </button>
              </p>
            )}
          </div>

          {/* Subtle footer credit */}
          <div className="py-2 text-center text-xs text-slate-400 dark:text-slate-600">
            Lembreto &bull; Sistema de Gestão e Lembretes
          </div>
        </section>
      </main>
    </div>
  );
}
