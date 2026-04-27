import React from 'react';
import { cn } from '../lib/cn';

interface SidebarItemProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  badgeTone?: 'default' | 'alert';
  testId?: string;
}

export function SidebarItem({
  active,
  onClick,
  icon,
  label,
  badge,
  badgeTone = 'default',
  testId,
}: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'group flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left transition-all',
        active
          ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-[0_14px_32px_-20px_rgba(37,99,235,0.7)]'
          : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white',
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl border transition-colors',
            active
              ? 'border-white/15 bg-white/10 text-white'
              : 'border-slate-200 bg-white text-slate-400 group-hover:border-slate-300 group-hover:text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400 dark:group-hover:border-white/20 dark:group-hover:text-slate-200',
          )}
        >
          <span className="icon-slot h-5 w-5">
            {icon}
          </span>
        </div>
        <div>
          <span className="block text-sm font-semibold">{label}</span>
          <span
            className={cn(
              'block text-xs',
              active ? 'text-white/80' : 'text-slate-400 dark:text-slate-500',
            )}
          >
            Acesse rapidamente
          </span>
        </div>
      </div>

      {!!badge && badge > 0 && (
        <span
          className={cn(
            'inline-flex min-w-8 items-center justify-center rounded-full px-2.5 py-1 text-xs font-bold',
            badgeTone === 'alert'
              ? active
                ? 'bg-rose-500/20 text-white'
                : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200'
              : active
                ? 'bg-white/15 text-white'
                : 'bg-slate-200 text-slate-700 dark:bg-white/[0.08] dark:text-slate-200',
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
