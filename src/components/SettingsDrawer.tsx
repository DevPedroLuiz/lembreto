// src/components/SettingsDrawer.tsx
// Slide-in drawer for app settings

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Settings, Moon, Volume2, ShieldAlert, CheckCircle2 } from 'lucide-react';

// ── Toggle sub-component ──────────────────────────────────────────────────────
function Toggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-12 h-6 rounded-full relative transition-colors focus:outline-none border shadow-inner ${
        active
          ? 'bg-blue-500 border-blue-600'
          : 'bg-slate-200 dark:bg-[#040814] border-slate-300 dark:border-white/10'
      }`}
    >
      <motion.div
        animate={{ x: active ? 24 : 2 }}
        className="w-5 h-5 rounded-full shadow-sm absolute top-0 bg-white"
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
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[100]"
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full max-w-sm bg-white dark:bg-[#040814] shadow-2xl z-[101] border-l border-slate-200 dark:border-white/10 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Settings size={20} className="text-blue-500" /> Configurações
              </h2>
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Appearance */}
              <section>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Moon size={14} /> Aparência
                </h3>
                <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                  <span className="font-semibold text-sm">Modo Escuro</span>
                  <Toggle active={darkMode} onClick={onToggleDarkMode} />
                </div>
              </section>

              {/* Behaviour */}
              <section>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Settings size={14} /> Comportamento
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                    <span className="font-semibold text-sm flex items-center gap-2">
                      <Volume2 size={16} className="text-slate-400" /> Efeitos Sonoros
                    </span>
                    <Toggle active={sound} onClick={onToggleSound} />
                  </div>
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                    <span className="font-semibold text-sm flex items-center gap-2">
                      <ShieldAlert size={16} className="text-slate-400" /> Confirmar Exclusão
                    </span>
                    <Toggle active={confirmDelete} onClick={onToggleConfirmDelete} />
                  </div>
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-white/5 p-4 rounded-2xl">
                    <span className="font-semibold text-sm flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-slate-400" /> Exibir Concluídas
                    </span>
                    <Toggle active={showCompleted} onClick={onToggleShowCompleted} />
                  </div>
                </div>
              </section>
            </div>

            <div className="p-6 border-t border-slate-100 dark:border-white/5 shrink-0">
              <p className="text-xs text-center text-slate-400">
                Configurações salvas no navegador.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
