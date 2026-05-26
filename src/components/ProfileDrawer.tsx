import React, { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BadgeCheck,
  Camera,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  Settings,
  ShieldCheck,
  Trash2,
  UserIcon as User,
  X,
} from 'lucide-react';
import type { User as UserType } from '../types';
import { useSwipeToClose } from '../hooks/useSwipeToClose';
import { MAX_AVATAR_BYTES, isAllowedAvatarMimeType } from '../../lib/avatar';

export { User as UserIcon };

interface ProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onLogout: () => void;
  onOpenSettings?: () => void;
  currentUser: UserType;
  isSubmitting?: boolean;
  saveSuccess?: boolean;
  name: string;
  setName: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  avatar: string | null;
  setAvatar: (value: string | null) => void;
}

function getInitials(name: string, email: string) {
  const source = name.trim() || email.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase() || 'LB';
}

function getPasswordStrength(password: string) {
  if (!password) {
    return {
      label: 'Senha atual mantida',
      helper: 'Preencha apenas se quiser trocar a senha.',
      width: 0,
      tone: 'bg-slate-200 dark:bg-white/10',
      textTone: 'text-slate-500 dark:text-slate-400',
    };
  }

  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 10) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (password.length < 6) {
    return {
      label: 'Muito curta',
      helper: 'Use pelo menos 6 caracteres para salvar.',
      width: 18,
      tone: 'bg-rose-500',
      textTone: 'text-rose-600 dark:text-rose-300',
    };
  }

  if (score <= 2) {
    return {
      label: 'Básica',
      helper: 'Funciona, mas pode ficar mais forte com números ou símbolos.',
      width: 42,
      tone: 'bg-amber-500',
      textTone: 'text-amber-700 dark:text-amber-300',
    };
  }

  if (score <= 4) {
    return {
      label: 'Boa',
      helper: 'Boa combinação para proteger sua conta.',
      width: 72,
      tone: 'bg-blue-500',
      textTone: 'text-blue-700 dark:text-blue-300',
    };
  }

  return {
    label: 'Forte',
    helper: 'Excelente. Essa senha está bem protegida.',
    width: 100,
    tone: 'bg-emerald-500',
    textTone: 'text-emerald-700 dark:text-emerald-300',
  };
}

export function ProfileDrawer({
  open,
  onClose,
  onSubmit,
  onLogout,
  onOpenSettings,
  currentUser,
  isSubmitting = false,
  saveSuccess = false,
  name,
  setName,
  email,
  setEmail,
  password,
  setPassword,
  avatar,
  setAvatar,
}: ProfileDrawerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [emailCopied, setEmailCopied] = React.useState(false);
  const swipe = useSwipeToClose({
    enabled: open,
    direction: 'right',
    onClose,
    locked: isSubmitting,
  });

  React.useEffect(() => {
    if (!open) {
      setAvatarError('');
      setShowPassword(false);
      setEmailCopied(false);
    }
  }, [open]);

  const openAvatarPicker = () => {
    if (!isSubmitting) fileInputRef.current?.click();
  };

  const handleAvatarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openAvatarPicker();
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isAllowedAvatarMimeType(file.type)) {
      setAvatarError('Use PNG, JPG, WEBP ou GIF para o avatar.');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError(`Avatar muito grande. Limite de ${Math.round(MAX_AVATAR_BYTES / 1024)} KB.`);
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatar(reader.result as string);
      setAvatarError('');
    };
    reader.readAsDataURL(file);
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email || currentUser.email);
      setEmailCopied(true);
      window.setTimeout(() => setEmailCopied(false), 1800);
    } catch {
      setEmailCopied(false);
    }
  };

  const initials = getInitials(name || currentUser.name, email || currentUser.email);
  const passwordStrength = getPasswordStrength(password);
  const passwordInvalid = Boolean(password && password.length < 6);
  const profileItems = [
    Boolean((avatar ?? currentUser.avatar)?.trim()),
    Boolean(name.trim()),
    Boolean(email.trim()),
    Boolean(currentUser.stateCode),
  ].filter(Boolean).length;
  const profileCompletion = Math.round((profileItems / 4) * 100);
  const locationLabel = currentUser.cityName && currentUser.stateCode
    ? `${currentUser.cityName}, ${currentUser.stateCode}`
    : currentUser.stateCode
      ? currentUser.stateCode
      : 'Não configurada';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (!isSubmitting) onClose();
            }}
            className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm dark:bg-black/70"
          />

          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: swipe.offset }}
            exit={{ x: '100%' }}
            transition={swipe.isDragging ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 220 }}
            className="fixed right-0 top-0 z-[101] flex h-full w-full max-w-2xl flex-col border-l border-slate-200/80 bg-white/96 pb-[max(env(safe-area-inset-bottom),0px)] shadow-[0_0_0_1px_rgba(15,23,42,0.02),0_24px_80px_-28px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-drawer-title"
          >
            {swipe.mobileEnabled && (
              <div
                className="flex justify-center border-b border-slate-200/70 px-4 py-3 dark:border-white/10"
                aria-hidden="true"
                {...swipe.bind}
              >
                <span className="h-1.5 w-14 rounded-full bg-slate-300/90 dark:bg-slate-700" />
              </div>
            )}

            <div className="border-b border-slate-200/80 bg-gradient-to-br from-blue-700 via-sky-600 to-cyan-500 px-5 py-5 text-white dark:border-white/10 md:px-7">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/12 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/80">
                    <BadgeCheck size={13} />
                    Conta Lembreto
                  </span>
                  <h2 id="profile-drawer-title" className="mt-4 text-2xl font-semibold tracking-tight text-white md:text-3xl">
                    Editar perfil
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-blue-50/90">
                    Personalize sua identidade, mantenha o acesso seguro e deixe a conta pronta para os recursos do sistema.
                  </p>
                </div>

                <button
                  onClick={onClose}
                  disabled={isSubmitting}
                  aria-label="Fechar perfil"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/12 text-white transition-colors hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 md:px-7">
              <form id="profile-form" onSubmit={onSubmit} className="space-y-5" aria-busy={isSubmitting}>
                {saveSuccess && (
                  <div
                    data-testid="profile-save-success"
                    className="flex items-center gap-3 rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                  >
                    <CheckCircle2 size={18} />
                    <div>
                      <p className="font-semibold">Perfil salvo com sucesso</p>
                      <p className="mt-0.5 text-xs text-emerald-600/90 dark:text-emerald-300/90">
                        As alterações já foram aplicadas à sua conta.
                      </p>
                    </div>
                  </div>
                )}

                <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_54px_-38px_rgba(15,23,42,0.42)] dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="bg-slate-50/80 p-5 dark:bg-white/[0.03]">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                      <div
                        data-testid="profile-avatar-trigger"
                        className={`relative w-fit ${isSubmitting ? 'cursor-wait' : 'cursor-pointer'}`}
                        onClick={openAvatarPicker}
                        onKeyDown={handleAvatarKeyDown}
                        role="button"
                        tabIndex={isSubmitting ? -1 : 0}
                        aria-label="Alterar avatar"
                        aria-disabled={isSubmitting}
                      >
                        {avatar ? (
                          <img
                            src={avatar}
                            alt="Avatar"
                            data-testid="profile-avatar-preview"
                            className="h-28 w-28 rounded-[30px] object-cover shadow-md"
                          />
                        ) : (
                          <div
                            data-testid="profile-avatar-preview"
                            className="flex h-28 w-28 items-center justify-center rounded-[30px] bg-gradient-to-br from-blue-600 to-cyan-500 text-3xl font-bold text-white shadow-md"
                          >
                            {initials}
                          </div>
                        )}

                        <div className="absolute inset-0 flex items-center justify-center rounded-[30px] bg-black/45 opacity-0 transition-opacity hover:opacity-100">
                          {isSubmitting ? (
                            <Loader2 size={20} className="animate-spin text-white" />
                          ) : (
                            <Camera size={20} className="text-white" />
                          )}
                        </div>

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          data-testid="profile-avatar-input"
                          disabled={isSubmitting}
                          className="hidden"
                          onChange={handleAvatarChange}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-xl font-semibold text-slate-950 dark:text-white">{name || currentUser.name}</h3>
                        <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{email || currentUser.email}</p>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={openAvatarPicker}
                            disabled={isSubmitting}
                            className="action-secondary min-h-[44px] justify-center rounded-2xl px-4 py-0 text-sm"
                          >
                            <Camera size={16} />
                            Alterar foto
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAvatar(null);
                              setAvatarError('');
                            }}
                            disabled={isSubmitting || !avatar}
                            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-600 transition-all hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
                          >
                            <Trash2 size={16} />
                            Remover foto
                          </button>
                        </div>
                      </div>
                    </div>

                    {avatarError && (
                      <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                        {avatarError}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-3 p-5 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Perfil</p>
                      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{profileCompletion}%</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${profileCompletion}%` }} />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Localização</p>
                      <p className="mt-2 truncate text-sm font-semibold text-slate-950 dark:text-white">{locationLabel}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Segurança</p>
                      <p className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
                        {password ? passwordStrength.label : 'Senha protegida'}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="surface-soft p-5">
                  <div className="mb-5 flex items-start gap-3">
                    <span className="icon-slot h-10 w-10 rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                      <User size={18} />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Informações da conta</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        Esses dados aparecem no app e são usados para entrar na sua conta.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Nome
                      </label>
                      <input
                        autoFocus
                        required
                        type="text"
                        autoComplete="name"
                        data-testid="profile-name-input"
                        value={name}
                        disabled={isSubmitting}
                        onChange={(event) => setName(event.target.value)}
                        className="field-control"
                      />
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          E-mail
                        </label>
                        <button
                          type="button"
                          onClick={copyEmail}
                          disabled={isSubmitting}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300"
                        >
                          <Copy size={13} />
                          {emailCopied ? 'Copiado' : 'Copiar'}
                        </button>
                      </div>
                      <div className="relative">
                        <Mail className="field-icon" size={18} />
                        <input
                          required
                          type="email"
                          autoComplete="email"
                          data-testid="profile-email-input"
                          value={email}
                          disabled={isSubmitting}
                          onChange={(event) => setEmail(event.target.value)}
                          className="field-control field-control-with-icon"
                        />
                      </div>
                    </div>
                  </div>
                </section>

                <section className="surface-soft p-5">
                  <div className="mb-5 flex items-start gap-3">
                    <span className="icon-slot h-10 w-10 rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                      <ShieldCheck size={18} />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Segurança</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        Troque a senha apenas quando quiser. Se deixar em branco, a senha atual continua valendo.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Nova senha
                    </label>
                    <div className="relative">
                      <KeyRound className="field-icon" size={18} />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        data-testid="profile-password-input"
                        placeholder="Deixe em branco para manter a senha atual"
                        value={password}
                        disabled={isSubmitting}
                        onChange={(event) => setPassword(event.target.value)}
                        aria-invalid={passwordInvalid ? 'true' : 'false'}
                        className={`field-control field-control-with-icon pr-12 ${passwordInvalid ? 'border-rose-300 bg-rose-50/70 text-rose-700 focus:border-rose-400 focus:ring-rose-500/10 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200' : ''}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        disabled={isSubmitting}
                        aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                        className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.08] dark:hover:text-white"
                      >
                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>

                    <div className="mt-3">
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                        <div className={`h-full rounded-full transition-all ${passwordStrength.tone}`} style={{ width: `${passwordStrength.width}%` }} />
                      </div>
                      <p className={`mt-2 text-sm font-medium ${passwordStrength.textTone}`}>
                        {passwordStrength.label}: {passwordStrength.helper}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="surface-soft p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="icon-slot h-10 w-10 rounded-2xl bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300">
                        <MapPin size={18} />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Preferências do sistema</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                          Localização de feriados e organização ficam nas configurações do Lembreto.
                        </p>
                      </div>
                    </div>

                    {onOpenSettings && (
                      <button
                        type="button"
                        onClick={onOpenSettings}
                        disabled={isSubmitting}
                        className="action-secondary min-h-[46px] justify-center rounded-2xl px-4 py-0 text-sm"
                      >
                        <Settings size={16} />
                        Configurar
                      </button>
                    )}
                  </div>
                </section>
              </form>
            </div>

            <div className="border-t border-slate-200/80 px-5 py-5 dark:border-white/10 md:px-7">
              <div className="space-y-3">
                <button
                  form="profile-form"
                  type="submit"
                  data-testid="profile-submit-button"
                  disabled={isSubmitting || saveSuccess || passwordInvalid}
                  className="action-primary w-full rounded-2xl py-4 disabled:cursor-wait disabled:opacity-70"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Salvando alterações...
                    </>
                  ) : saveSuccess ? (
                    <>
                      <CheckCircle2 size={18} />
                      Salvo com sucesso
                    </>
                  ) : (
                    'Salvar perfil'
                  )}
                </button>

                <button
                  onClick={() => {
                    onClose();
                    onLogout();
                  }}
                  type="button"
                  disabled={isSubmitting}
                  className="action-secondary w-full rounded-2xl py-4 text-rose-600 dark:text-rose-300"
                >
                  <LogOut size={18} />
                  Sair da conta
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
