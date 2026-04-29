import React from 'react';
import { cn } from '../lib/cn';

interface MetricCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  error?: boolean;
  pulse?: boolean;
  tone?: 'brand' | 'emerald' | 'violet';
  onClick?: () => void;
  ariaLabel?: string;
  testId?: string;
}

export function MetricCard({
  title,
  value,
  icon,
  error,
  pulse = false,
  tone = 'brand',
  onClick,
  ariaLabel,
  testId,
}: MetricCardProps) {
  const isInteractive = Boolean(onClick);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        'surface-panel flex min-h-[152px] w-full flex-col justify-between p-5 text-left md:p-6',
        isInteractive && 'transition-all hover:-translate-y-1 hover:border-slate-300 hover:bg-white dark:hover:border-white/20 dark:hover:bg-white/[0.07]',
        isInteractive && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
        error && 'border-rose-200/80 dark:border-rose-500/20',
      )}
      disabled={!isInteractive}
    >
      <div className="space-y-4">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">{title}</p>
        </div>

        <div className="flex items-end justify-between gap-4">
          <p className="font-display text-[2.45rem] font-semibold leading-none tracking-tight text-slate-950 dark:text-white">
            {value}
          </p>
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border shadow-[0_16px_32px_-24px_rgba(15,23,42,0.45)]',
              pulse && 'animate-pulse',
              error
                ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
                : tone === 'emerald'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : tone === 'violet'
                    ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300'
                    : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300',
            )}
          >
            <span className="icon-slot h-5 w-5">
              {icon}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-7 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            error
              ? 'bg-rose-500/75 dark:bg-rose-400/75'
              : tone === 'emerald'
                ? 'bg-emerald-500/75 dark:bg-emerald-400/75'
                : tone === 'violet'
                  ? 'bg-violet-500/75 dark:bg-violet-400/75'
                  : 'bg-blue-500/75 dark:bg-blue-400/75',
          )}
          style={{ width: `${Math.min(Math.max(value * 12, 16), 100)}%` }}
        />
      </div>
    </button>
  );
}
