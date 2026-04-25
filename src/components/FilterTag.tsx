// src/components/FilterTag.tsx
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
        'flex items-center justify-between w-full px-4 py-2.5 rounded-xl transition-all font-medium text-sm whitespace-nowrap outline-none',
        active
          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md'
          : 'bg-slate-100/50 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-white/10'
      )}
    >
      <span className="flex items-center gap-2">
        {label !== 'Todas' && (
          <Tag
            size={14}
            className={active ? 'text-white/70 dark:text-slate-900/70' : 'text-slate-400'}
          />
        )}
        {label}
      </span>
      {count !== undefined && (
        <span
          className={cn(
            'text-[10px] font-bold px-1.5 py-0.5 rounded-md',
            active ? 'bg-white/20 dark:bg-black/10' : 'bg-slate-200 dark:bg-white/10'
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
