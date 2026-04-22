// src/components/Toast.tsx
// Animated toast notification

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.9 }}
          className="fixed bottom-24 md:bottom-8 right-6 z-[200] bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-4 rounded-2xl shadow-2xl flex items-start gap-3 max-w-[320px]"
        >
          <div className="bg-white/20 dark:bg-black/10 p-2 rounded-full shrink-0">
            <BellRing size={16} />
          </div>
          <div className="flex-1 pr-4">
            <h4 className="font-bold text-sm mb-0.5">{toast.title}</h4>
            <p className="text-xs opacity-90">{toast.message}</p>
          </div>
          <button
            onClick={onDismiss}
            className="absolute top-4 right-4 opacity-50 hover:opacity-100"
          >
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
