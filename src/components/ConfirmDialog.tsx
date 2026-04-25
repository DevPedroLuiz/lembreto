import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  isConfirming = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (!isConfirming) onCancel();
            }}
            className="fixed inset-0 z-[120] bg-slate-900/45 dark:bg-black/65 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', damping: 24, stiffness: 260 }}
            className="fixed inset-x-4 top-1/2 z-[121] mx-auto w-auto max-w-md -translate-y-1/2 rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#040814]"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
            data-testid="confirm-dialog"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                <AlertTriangle size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 id="confirm-dialog-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                  {title}
                </h3>
                <p id="confirm-dialog-message" className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  {message}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                data-testid="confirm-dialog-cancel"
                disabled={isConfirming}
                onClick={onCancel}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                data-testid="confirm-dialog-confirm"
                disabled={isConfirming}
                onClick={onConfirm}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-wait disabled:opacity-70"
              >
                {isConfirming ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Excluindo...
                  </>
                ) : (
                  confirmLabel
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
