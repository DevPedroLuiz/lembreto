import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Moon,
  Settings,
  ShieldAlert,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { useSwipeToClose } from '../hooks/useSwipeToClose';

function Toggle({
  active,
  onClick,
  ariaLabel,
  autoFocus = false,
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      role="switch"
      aria-checked={active}
      className={[
        'relative h-8 w-14 rounded-full border transition-colors',
        active
          ? 'border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500'
          : 'border-slate-300 bg-slate-200 dark:border-white/10 dark:bg-slate-800',
      ].join(' ')}
    >
      <motion.span
        animate={{ x: active ? 28 : 4 }}
        transition={{ type: 'spring', stiffness: 360, damping: 28 }}
        className={[
          'absolute top-1 flex h-6 w-6 items-center justify-center rounded-full shadow-sm',
          active ? 'bg-white' : 'bg-white dark:bg-slate-200',
        ].join(' ')}
      />
    </button>
  );
}

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  notificationsEnabled: boolean;
  onToggleNotifications: () => void;
  onOpenNotificationsCenter: () => void;
  sound: boolean;
  onToggleSound: () => void;
  confirmDelete: boolean;
  onToggleConfirmDelete: () => void;
  showCompleted: boolean;
  onToggleShowCompleted: () => void;
}

const settingCards = [
  {
    key: 'darkMode',
    title: 'Modo escuro',
    description: 'Ajusta a leitura para ambientes com pouca luz e mantém o contraste confortável.',
    helper: 'Visual',
    icon: Moon,
  },
  {
    key: 'notifications',
    title: 'Notificações do sistema',
    description: 'Controla a central, os avisos temporários e os alertas importantes do aplicativo.',
    helper: 'Acompanhamento',
    icon: BellRing,
  },
  {
    key: 'sound',
    title: 'Efeitos sonoros',
    description: 'Reproduz um retorno discreto em ações importantes, como conclusão de lembretes.',
    helper: 'Feedback',
    icon: Volume2,
  },
  {
    key: 'confirmDelete',
    title: 'Confirmar exclusão',
    description: 'Evita remoções acidentais pedindo confirmação antes de excluir um lembrete.',
    helper: 'Segurança',
    icon: ShieldAlert,
  },
  {
    key: 'showCompleted',
    title: 'Mostrar concluídos',
    description: 'Mantém o histórico de lembretes finalizados visível para revisão rápida.',
    helper: 'Organização',
    icon: CheckCircle2,
  },
] as const;

export function SettingsDrawer({
  open,
  onClose,
  darkMode,
  onToggleDarkMode,
  notificationsEnabled,
  onToggleNotifications,
  onOpenNotificationsCenter,
  sound,
  onToggleSound,
  confirmDelete,
  onToggleConfirmDelete,
  showCompleted,
  onToggleShowCompleted,
}: SettingsDrawerProps) {
  const swipe = useSwipeToClose({
    enabled: open,
    direction: 'down',
    onClose,
  });

  const toggleMap = {
    darkMode: {
      active: darkMode,
      onClick: onToggleDarkMode,
      ariaLabel: 'Alternar modo escuro',
    },
    notifications: {
      active: notificationsEnabled,
      onClick: onToggleNotifications,
      ariaLabel: 'Alternar notificações do sistema',
    },
    sound: {
      active: sound,
      onClick: onToggleSound,
      ariaLabel: 'Alternar efeitos sonoros',
    },
    confirmDelete: {
      active: confirmDelete,
      onClick: onToggleConfirmDelete,
      ariaLabel: 'Alternar confirmação de exclusão',
    },
    showCompleted: {
      active: showCompleted,
      onClick: onToggleShowCompleted,
      ariaLabel: 'Alternar exibição de lembretes concluídos',
    },
  } as const;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm"
          />

          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: swipe.offset, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={swipe.isDragging ? { duration: 0 } : { type: 'spring', damping: 26, stiffness: 260 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-drawer-title"
            className="fixed inset-x-4 top-1/2 z-[101] mx-auto flex max-h-[88vh] w-full max-w-5xl -translate-y-1/2 flex-col overflow-hidden rounded-[32px] border border-slate-200/80 bg-white/96 shadow-[0_36px_120px_-42px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94"
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
                <div className="min-w-0">
                  <span className="section-eyebrow">
                    <Settings size={14} />
                    Preferências
                  </span>
                  <h2 id="settings-drawer-title" className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-3xl">
                    Configurações
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                    Ajuste notificações, visibilidade e comportamento do aplicativo em uma visão clara e agradável de usar.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar configurações"
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-7">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_340px]">
                <section className="space-y-4">
                  <div className="surface-soft p-5">
                    <div className="flex items-start gap-3">
                      <span className="icon-slot h-11 w-11 rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_16px_32px_-20px_rgba(37,99,235,0.7)]">
                        <Sparkles size={18} />
                      </span>
                      <div>
                        <h3 className="text-base font-semibold text-slate-950 dark:text-white">
                          Ajustes rápidos do seu espaço
                        </h3>
                        <p className="mt-1 text-sm leading-7 text-slate-500 dark:text-slate-400">
                          Todas as alterações abaixo são salvas neste navegador e refletem imediatamente no seu uso diário.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {settingCards.map((card, index) => {
                      const config = toggleMap[card.key];
                      const Icon = card.icon;

                      return (
                        <section
                          key={card.key}
                          className="surface-soft flex h-full flex-col justify-between gap-5 p-5"
                        >
                          <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
                              <Icon size={18} />
                            </div>

                            <div className="min-w-0">
                              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                {card.helper}
                              </p>
                              <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                                {card.title}
                              </h3>
                              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                {card.description}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
                            <div>
                              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                {config.active ? 'Ativado' : 'Desativado'}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                Toque para alternar esta preferência.
                              </p>
                            </div>

                            <Toggle
                              active={config.active}
                              onClick={config.onClick}
                              ariaLabel={config.ariaLabel}
                              autoFocus={index === 0}
                            />
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </section>

                <aside className="space-y-4">
                  <section className="surface-soft p-5">
                    <span className="section-eyebrow">
                      <BellRing size={14} />
                      Central
                    </span>
                    <h3 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">
                      Central de notificações
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
                      Abra o histórico completo dos avisos do sistema, revise pendências e retome o contexto exato com um clique.
                    </p>

                    <button
                      type="button"
                      onClick={onOpenNotificationsCenter}
                      data-testid="settings-open-notifications-center"
                      className="action-secondary mt-5 w-full justify-between"
                    >
                      Abrir central de notificações
                      <ArrowRight size={16} />
                    </button>
                  </section>

                  <section className="surface-soft p-5">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      O que muda aqui
                    </h3>
                    <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                      <li className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
                        O tema pode ser ajustado sem sair da tela atual.
                      </li>
                      <li className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
                        Você decide se quer confirmação extra antes de excluir.
                      </li>
                      <li className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
                        A central registra eventos importantes para revisão posterior.
                      </li>
                    </ul>
                  </section>
                </aside>
              </div>
            </div>

            <div className="border-t border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                As configurações são salvas neste navegador e aplicadas imediatamente.
              </p>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
