// src/components/TaskItem.tsx
// Individual task row used in both Dashboard and Tasks views

import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Circle, Clock, Loader2, Trash2, Tag } from 'lucide-react';
import { format, isPast, isToday, isTomorrow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getTaskTimeDescription, getTaskTimeLabel } from '../lib/taskDueDate';
import type { Task, Priority } from '../types';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

const PRIORITY_COLORS: Record<Priority, string> = {
  low: 'text-slate-500 bg-slate-100 dark:bg-white/5',
  medium: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10',
  high: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Baixa',
  medium: 'Media',
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
      if (isTomorrow(date)) return 'Amanha';
      return format(date, 'dd MMM', { locale: ptBR });
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
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={!isCompleted && !isBusy ? { y: -2 } : {}}
      className={cn(
        'group relative flex items-start gap-4 p-4 md:p-5 rounded-2xl transition-all border',
        isBusy && 'opacity-70',
        isCompleted
          ? 'bg-slate-50 dark:bg-white/[0.01] border-transparent'
          : 'bg-white dark:bg-[#0a0f1e] border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 hover:shadow-xl hover:shadow-slate-200/40 dark:hover:shadow-black/40 cursor-pointer'
      )}
      onClick={() => {
        if (!isCompleted && !isBusy) onEdit(task);
      }}
    >
      <button
        data-testid="task-toggle"
        disabled={isBusy}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task);
        }}
        className={cn(
          'mt-0.5 shrink-0 transition-colors disabled:opacity-50 disabled:cursor-wait',
          isCompleted
            ? 'text-emerald-500'
            : 'text-slate-300 hover:text-blue-500 dark:text-slate-600 dark:hover:text-blue-400'
        )}
      >
        {isToggling ? (
          <Loader2 size={24} className="animate-spin" />
        ) : isCompleted ? (
          <CheckCircle2 size={24} />
        ) : (
          <Circle size={24} />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <h3
          className={cn(
            'font-semibold text-base truncate mb-1',
            isCompleted
              ? 'line-through text-slate-400'
              : 'text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400'
          )}
        >
          {task.title}
        </h3>

        {!compact && task.description && (
          <p className="text-sm text-slate-500 line-clamp-1 mb-2 pr-8">
            {task.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-1">
          {!isCompleted && (
            <span
              className={cn(
                'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest',
                PRIORITY_COLORS[task.priority]
              )}
            >
              {PRIORITY_LABELS[task.priority]}
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md">
            <Tag size={10} />
            {task.category || 'Geral'}
          </span>
          <span
            data-testid="task-due-badge"
            data-overdue-kind={overdueKind}
            title={timeDescription}
            aria-label={`${formatDate()} - ${timeDescription}`}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest',
              overdueKind === 'timed'
                ? 'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/10'
                : overdueKind === 'all-day'
                  ? 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-500/10'
                : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5'
            )}
          >
            <Clock size={10} />
            {formatDate()}
          </span>
          {timeLabel && (
            <span
              data-testid="task-time-badge"
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest',
                isOverdue
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400'
              )}
            >
              {timeLabel}
            </span>
          )}
          {overdueKind === 'all-day' && (
            <span
              data-testid="task-all-day-badge"
              className="flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
            >
              Dia todo
            </span>
          )}
          {isDeleting && (
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 px-2 py-0.5 rounded-md">
              <Loader2 size={10} className="animate-spin" />
              Excluindo
            </span>
          )}
          {isToggling && (
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 px-2 py-0.5 rounded-md">
              <Loader2 size={10} className="animate-spin" />
              {isCompleted ? 'Reabrindo' : 'Concluindo'}
            </span>
          )}
        </div>
      </div>

      <button
        data-testid="task-delete"
        disabled={isBusy}
        onClick={(e) => onDelete(task.id, e)}
        className={cn(
          'p-2 bg-slate-50 dark:bg-white/5 rounded-xl transition-all absolute right-4 top-4 disabled:cursor-wait',
          isDeleting
            ? 'opacity-100 text-rose-500'
            : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10'
        )}
      >
        {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
      </button>
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
    prev.isToggling === next.isToggling
);
