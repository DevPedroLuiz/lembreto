import React from 'react';
import { Tag } from 'lucide-react';
import { cn } from '../lib/cn';

interface FilterTagProps {
  key?: string | number;
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}

export function FilterTag({ active, onClick, label, count }: FilterTagProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium transition-all',
        active
          ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-[0_12px_24px_-18px_rgba(37,99,235,0.7)]'
          : 'bg-slate-100/70 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white',
      )}
    >
      <span className="flex items-center gap-2">
        {label !== 'Todas' && (
          <span className={cn('icon-slot h-4 w-4', active ? 'text-white/80' : 'text-slate-400 dark:text-slate-500')}>
            <Tag size={14} />
          </span>
        )}
        {label}
      </span>

      {count !== undefined && (
        <span
          className={cn(
            'inline-flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-bold',
            active
              ? 'bg-white/15 text-white'
              : 'bg-slate-200 text-slate-700 dark:bg-white/[0.08] dark:text-slate-200',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
