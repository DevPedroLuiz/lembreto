import React from 'react';
import { Loader2 } from 'lucide-react';
import { BrandMark } from './BrandLogo';

export function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="surface-panel flex w-full max-w-sm flex-col items-center gap-4 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-[28px] bg-slate-950 shadow-[0_18px_38px_-22px_rgba(14,165,255,0.72)] ring-1 ring-cyan-300/20">
          <BrandMark className="h-12 w-12" />
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
