// src/components/SidebarItem.tsx
import React from 'react';
import { cn } from '../lib/cn';

interface SidebarItemProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  testId?: string;
}

export function SidebarItem({ active, onClick, icon, label, badge, testId }: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all font-medium outline-none group',
        active
          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md'
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(active ? 'text-white dark:text-slate-900' : 'text-slate-400')}>
          {icon}
        </div>
        <span>{label}</span>
      </div>
      {!!badge && badge > 0 && (
        <span
          className={cn(
            'text-[10px] font-bold px-2 py-0.5 rounded-full',
            active
              ? 'bg-white/20 dark:bg-black/10'
              : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300'
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
