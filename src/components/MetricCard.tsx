// src/components/MetricCard.tsx
import React from 'react';
import { cn } from '../lib/cn';

interface MetricCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  error?: boolean;
}

export function MetricCard({ title, value, icon, error }: MetricCardProps) {
  return (
    <div className="bg-white dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 rounded-3xl p-5 md:p-6 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4">
        <span className="text-slate-500 font-medium text-sm">{title}</span>
        <div
          className={cn(
            'p-2 rounded-xl',
            error
              ? 'bg-rose-50 text-rose-500 dark:bg-rose-500/10'
              : 'bg-slate-50 text-slate-400 dark:bg-white/5'
          )}
        >
          {icon}
        </div>
      </div>
      <div className="text-4xl font-light">{value}</div>
    </div>
  );
}
