import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  Moon,
  Settings,
  ShieldAlert,
  Volume2,
  X,
} from 'lucide-react';

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
    description: 'Ativa uma interface mais confortável para ambientes com pouca luz.',
    icon: Moon,
  },
  {
    key: 'sound',
    title: 'Efeitos sonoros',
    description: 'Reproduz um pequeno som ao concluir lembretes importantes.',
    icon: Volume2,
  },
  {
    key: 'confirmDelete',
    title: 'Confirmar exclusão',
    description: 'Solicita confirmação antes de remover um lembrete da agenda.',
    icon: ShieldAlert,
  },
  {
    key: 'showCompleted',
    title: 'Mostrar concluídos',
    description: 'Mantém o histórico de lembretes finalizados visível na listagem.',
    icon: CheckCircle2,
  },
] as const;

export function SettingsDrawer({
  open,
  onClose,
  darkMode,
  onToggleDarkMode,
  sound,
  onToggleSound,
  confirmDelete,
  onToggleConfirmDelete,
  showCompleted,
  onToggleShowCompleted,
}: SettingsDrawerProps) {
  const toggleMap = {
    darkMode: {
      active: darkMode,
      onClick: onToggleDarkMode,
      ariaLabel: 'Alternar modo escuro',
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
            className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm dark:bg-black/70"
          />

          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="fixed right-0 top-0 z-[101] flex h-full w-full max-w-lg flex-col border-l border-slate-200/80 bg-white/96 shadow-[0_0_0_1px_rgba(15,23,42,0.02),0_24px_80px_-28px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-drawer-title"
          >
            <div className="border-b border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="section-eyebrow">
                    <Settings size={14} />
                    Preferências
                  </span>
                  <h2 id="settings-drawer-title" className="mt-4 text-2xl font-semibold text-slate-950 dark:text-white">
                    Configurações
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    Ajuste o comportamento da interface para combinar com o seu ritmo de trabalho.
                  </p>
                </div>

                <button
                  onClick={onClose}
                  aria-label="Fechar configurações"
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-7">
              <div className="space-y-4">
                {settingCards.map((card, index) => {
                  const config = toggleMap[card.key];
                  const Icon = card.icon;

                  return (
                    <section key={card.key} className="surface-soft flex items-start justify-between gap-4 p-5">
                      <div className="flex gap-4 pr-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
                          <Icon size={18} />
                        </div>

                        <div>
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{card.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                            {card.description}
                          </p>
                        </div>
                      </div>

                      <Toggle
                        active={config.active}
                        onClick={config.onClick}
                        ariaLabel={config.ariaLabel}
                        autoFocus={index === 0}
                      />
                    </section>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                As configurações são salvas neste navegador.
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
