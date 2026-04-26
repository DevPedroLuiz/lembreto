import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BellRing, X } from 'lucide-react';
import type { ToastMessage } from '../hooks/useToast';

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          data-testid="toast"
          className="fixed bottom-24 right-4 z-[200] flex max-w-[360px] items-start gap-3 rounded-[24px] border border-slate-200/80 bg-white/96 px-5 py-4 text-slate-900 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/92 dark:text-white md:bottom-8 md:right-8"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 text-white">
            <BellRing size={16} />
          </div>

          <div className="min-w-0 flex-1 pr-5">
            <h4 data-testid="toast-title" className="text-sm font-semibold">
              {toast.title}
            </h4>
            <p data-testid="toast-message" className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {toast.message}
            </p>
          </div>

          <button
            onClick={onDismiss}
            aria-label="Fechar notificação"
            className="absolute right-4 top-4 text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
