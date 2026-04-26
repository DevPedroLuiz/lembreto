import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Circle, Clock3, Loader2, Tag, Trash2 } from 'lucide-react';
import { format, isPast, isToday, isTomorrow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getTaskTimeDescription, getTaskTimeLabel } from '../lib/taskDueDate';
import type { Priority, Task } from '../types';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

const PRIORITY_COLORS: Record<Priority, string> = {
  low: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  high: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};

interface TaskItemProps {
  key?: string | number;
  task: Task;
  onToggle: (t: Task) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onEdit: (t: Task) => void;
  compact?: boolean;
  isCompletedSection?: boolean;
  isDeleting?: boolean;
  isToggling?: boolean;
}

function TaskItemComponent({
  task,
  onToggle,
  onDelete,
  onEdit,
  compact,
  isDeleting = false,
  isToggling = false,
}: TaskItemProps) {
  const safeDate = () => {
    try {
      return parseISO(task.dueDate);
    } catch {
      return new Date();
    }
  };

  const date = safeDate();
  const isOverdue = isPast(date) && !isToday(date) && task.status !== 'completed';
  const isCompleted = task.status === 'completed';
  const isBusy = isDeleting || isToggling;
  const timeLabel = getTaskTimeLabel(task.dueDate);
  const timeDescription = getTaskTimeDescription(task.dueDate);
  const overdueKind = isOverdue ? (timeLabel ? 'timed' : 'all-day') : 'none';

  const formatDate = () => {
    try {
      if (isToday(date)) return 'Hoje';
      if (isTomorrow(date)) return 'Amanhã';
      return format(date, "dd 'de' MMM", { locale: ptBR });
    } catch {
      return '--';
    }
  };

  return (
    <motion.div
      data-testid="task-item"
      data-task-id={task.id}
      data-task-title={task.title}
      data-task-status={task.status}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={!isBusy ? { y: -2 } : {}}
      role={!isBusy ? 'button' : undefined}
      tabIndex={!isBusy ? 0 : -1}
      aria-label={!isBusy ? `Abrir lembrete ${task.title}` : undefined}
      onClick={() => {
        if (!isBusy) onEdit(task);
      }}
      onKeyDown={(event) => {
        if (isBusy) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onEdit(task);
      }}
      className={cn(
        'surface-soft group relative flex items-start gap-4 p-4 md:p-5',
        isBusy && 'opacity-75',
        !isBusy && 'cursor-pointer hover:border-slate-300 hover:bg-white dark:hover:border-white/20 dark:hover:bg-white/[0.07]',
        isCompleted && 'border-slate-200/70 bg-slate-50/88 dark:border-white/10 dark:bg-white/[0.03]',
      )}
    >
      <div
        className={cn(
          'absolute inset-y-4 left-3 w-1 rounded-full',
          task.priority === 'high'
            ? 'bg-rose-400/80'
            : task.priority === 'medium'
              ? 'bg-amber-400/80'
              : 'bg-slate-300 dark:bg-slate-600',
        )}
      />

      <button
        data-testid="task-toggle"
        disabled={isBusy}
        aria-label={isCompleted ? `Reabrir lembrete ${task.title}` : `Concluir lembrete ${task.title}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(task);
        }}
        className={cn(
          'ml-3 mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-all disabled:cursor-wait disabled:opacity-60',
          isCompleted
            ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
            : 'border-slate-200 bg-white text-slate-400 hover:border-blue-300 hover:text-blue-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-blue-400/30 dark:hover:text-blue-300',
        )}
      >
        {isToggling ? (
          <Loader2 size={22} className="animate-spin" />
        ) : isCompleted ? (
          <CheckCircle2 size={22} />
        ) : (
          <Circle size={22} />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3
              className={cn(
                'truncate text-base font-semibold',
                isCompleted
                  ? 'text-slate-400 line-through dark:text-slate-500'
                  : 'text-slate-900 dark:text-white',
              )}
            >
              {task.title}
            </h3>
            {!compact && task.description && (
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {task.description}
              </p>
            )}
          </div>

          <button
            data-testid="task-delete"
            disabled={isBusy}
            aria-label={`Excluir lembrete ${task.title}`}
            onClick={(event) => onDelete(task.id, event)}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-all disabled:cursor-wait md:opacity-0 md:group-hover:opacity-100',
              isDeleting
                ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300'
                : 'bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300',
            )}
          >
            {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!isCompleted && (
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em]',
                PRIORITY_COLORS[task.priority],
              )}
            >
              {PRIORITY_LABELS[task.priority]}
            </span>
          )}

          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
            <Tag size={12} />
            {task.category || 'Geral'}
          </span>

          <span
            data-testid="task-due-badge"
            data-overdue-kind={overdueKind}
            title={timeDescription}
            aria-label={`${formatDate()} - ${timeDescription}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
              overdueKind === 'timed'
                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
                : overdueKind === 'all-day'
                  ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
                  : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300',
            )}
          >
            <Clock3 size={12} />
            {formatDate()}
          </span>

          {timeLabel && (
            <span
              data-testid="task-time-badge"
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                isOverdue
                  ? 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/15 dark:text-rose-300'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300',
              )}
            >
              {timeLabel}
            </span>
          )}

          {overdueKind === 'all-day' && (
            <span
              data-testid="task-all-day-badge"
              className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-300"
            >
              Dia todo
            </span>
          )}

          {isDeleting && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
              <Loader2 size={12} className="animate-spin" />
              Excluindo
            </span>
          )}

          {isToggling && (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
              <Loader2 size={12} className="animate-spin" />
              {isCompleted ? 'Reabrindo' : 'Concluindo'}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export const TaskItem = React.memo(
  TaskItemComponent,
  (prev, next) =>
    prev.task.id === next.task.id &&
    prev.task.title === next.task.title &&
    prev.task.description === next.task.description &&
    prev.task.dueDate === next.task.dueDate &&
    prev.task.priority === next.task.priority &&
    prev.task.category === next.task.category &&
    prev.task.status === next.task.status &&
    prev.compact === next.compact &&
    prev.isDeleting === next.isDeleting &&
    prev.isToggling === next.isToggling,
);
