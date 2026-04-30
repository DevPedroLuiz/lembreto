import React, { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Camera, CheckCircle2, Loader2, LogOut, UserIcon as User, X } from 'lucide-react';
import type { User as UserType } from '../types';
import { useSwipeToClose } from '../hooks/useSwipeToClose';
import { MAX_AVATAR_BYTES, isAllowedAvatarMimeType } from '../../lib/avatar';

export { User as UserIcon };

interface ProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onLogout: () => void;
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

export function ProfileDrawer({
  open,
  onClose,
  onSubmit,
  onLogout,
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
  const swipe = useSwipeToClose({
    enabled: open,
    direction: 'right',
    onClose,
    locked: isSubmitting,
  });

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
            className="fixed right-0 top-0 z-[101] flex h-full w-full max-w-xl flex-col border-l border-slate-200/80 bg-white/96 pb-[max(env(safe-area-inset-bottom),0px)] shadow-[0_0_0_1px_rgba(15,23,42,0.02),0_24px_80px_-28px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94"
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

            <div className="border-b border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="section-eyebrow">Conta</span>
                  <h2 id="profile-drawer-title" className="mt-4 text-2xl font-semibold text-slate-950 dark:text-white">
                    Editar perfil
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    Atualize seus dados de acesso e personalize a apresentação da sua conta.
                  </p>
                </div>

                <button
                  onClick={onClose}
                  disabled={isSubmitting}
                  aria-label="Fechar perfil"
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-7">
              <form id="profile-form" onSubmit={onSubmit} className="space-y-6" aria-busy={isSubmitting}>
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

                <section className="surface-soft p-5">
                  <div className="mb-5 flex items-center gap-4">
                    <div
                      data-testid="profile-avatar-trigger"
                      className={`relative ${isSubmitting ? 'cursor-wait' : 'cursor-pointer'}`}
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
                          className="h-24 w-24 rounded-[28px] object-cover shadow-md"
                        />
                      ) : (
                        <div
                          data-testid="profile-avatar-preview"
                          className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-blue-100 text-blue-600 shadow-sm dark:bg-blue-500/10 dark:text-blue-300"
                        >
                          <User size={34} />
                        </div>
                      )}

                      <div className="absolute inset-0 flex items-center justify-center rounded-[28px] bg-black/45 opacity-0 transition-opacity hover:opacity-100">
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

                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{currentUser.name}</h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{currentUser.email}</p>
                      <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                        Toque na imagem para alterar o avatar
                      </p>
                    </div>
                  </div>

                  {avatarError && (
                    <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                      {avatarError}
                    </p>
                  )}
                </section>

                <section className="surface-soft p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Informações da conta</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Mantenha seus dados atualizados para facilitar o acesso.
                    </p>
                  </div>

                  <div className="space-y-4">
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
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        E-mail
                      </label>
                      <input
                        required
                        type="email"
                        autoComplete="email"
                        data-testid="profile-email-input"
                        value={email}
                        disabled={isSubmitting}
                        onChange={(event) => setEmail(event.target.value)}
                        className="field-control"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Nova senha
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        data-testid="profile-password-input"
                        placeholder="Deixe em branco para manter a senha atual"
                        value={password}
                        disabled={isSubmitting}
                        onChange={(event) => setPassword(event.target.value)}
                        className="field-control"
                      />
                    </div>
                  </div>
                </section>
              </form>
            </div>

            <div className="border-t border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <div className="space-y-3">
                <button
                  form="profile-form"
                  type="submit"
                  data-testid="profile-submit-button"
                  disabled={isSubmitting || saveSuccess}
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
