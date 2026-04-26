import React from 'react';
import { Loader2, Target } from 'lucide-react';

export function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="surface-panel flex w-full max-w-sm flex-col items-center gap-4 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-[28px] bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_18px_36px_-22px_rgba(37,99,235,0.65)]">
          <Target size={30} />
        </div>
        <div>
          <p className="font-semibold text-slate-950 dark:text-white">Preparando sua área de trabalho</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Estamos restaurando sua sessão.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 size={16} className="animate-spin" />
          Carregando...
        </div>
      </div>
    </div>
  );
}
