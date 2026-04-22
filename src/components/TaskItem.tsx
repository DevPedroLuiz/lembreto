// src/components/TaskItem.tsx
// Individual task row used in both Dashboard and Tasks views

import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Circle, Clock, Trash2, Tag } from 'lucide-react';
import { format, isPast, isToday, isTomorrow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
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
  medium: 'Média',
  high: 'Alta',
};

interface TaskItemProps {
  task: Task;
  onToggle: (t: Task) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onEdit: (t: Task) => void;
  compact?: boolean;
  isCompletedSection?: boolean;
}

export function TaskItem({
  task,
  onToggle,
  onDelete,
  onEdit,
  compact,
  isCompletedSection,
}: TaskItemProps) {
  const safeDate = () => {
    try {
      return parseISO(task.dueDate);
    } catch {
      return new Date();
    }
  };
  const date = safeDate();
  const isOverdue =
    isPast(date) && !isToday(date) && task.status !== 'completed';
  const isCompleted = task.status === 'completed';

  const formatDate = () => {
    try {
      if (isToday(date)) return 'Hoje';
      if (isTomorrow(date)) return 'Amanhã';
      return format(date, 'dd MMM', { locale: ptBR });
    } catch {
      return '—';
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={!isCompleted ? { y: -2 } : {}}
      className={cn(
        'group relative flex items-start gap-4 p-4 md:p-5 rounded-2xl transition-all border',
        isCompleted
          ? 'bg-slate-50 dark:bg-white/[0.01] border-transparent'
          : 'bg-white dark:bg-[#0a0f1e] border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 hover:shadow-xl hover:shadow-slate-200/40 dark:hover:shadow-black/40 cursor-pointer'
      )}
      onClick={() => {
        if (!isCompleted) onEdit(task);
      }}
    >
      {/* Toggle button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task);
        }}
        className={cn(
          'mt-0.5 shrink-0 transition-colors',
          isCompleted
            ? 'text-emerald-500'
            : 'text-slate-300 hover:text-blue-500 dark:text-slate-600 dark:hover:text-blue-400'
        )}
      >
        {isCompleted ? <CheckCircle2 size={24} /> : <Circle size={24} />}
      </button>

      {/* Content */}
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
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest',
              isOverdue
                ? 'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/10'
                : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5'
            )}
          >
            <Clock size={10} />
            {formatDate()}
          </span>
        </div>
      </div>

      {/* Delete button */}
      <button
        onClick={(e) => onDelete(task.id, e)}
        className="opacity-0 group-hover:opacity-100 p-2 text-slate-400 hover:text-rose-500 bg-slate-50 dark:bg-white/5 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition-all absolute right-4 top-4"
      >
        <Trash2 size={16} />
      </button>
    </motion.div>
  );
}
