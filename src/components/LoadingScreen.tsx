// src/components/LoadingScreen.tsx
import React from 'react';
import { Target } from 'lucide-react';

export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#040814]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20 animate-pulse">
          <Target size={32} />
        </div>
        <p className="text-slate-500 text-sm font-medium">Carregando sessão...</p>
      </div>
    </div>
  );
}
