import React from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  EllipsisVertical,
  FileText,
  Loader2,
  PencilLine,
  Tag,
  Trash2,
} from 'lucide-react';
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

const PRIORITY_ACCENTS: Record<Priority, string> = {
  low: 'from-slate-300 via-slate-200 to-slate-300 dark:from-slate-600 dark:via-slate-500 dark:to-slate-600',
  medium: 'from-amber-400 via-orange-300 to-amber-400',
  high: 'from-rose-500 via-red-400 to-rose-500',
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
  onToggleActive?: (t: Task) => void;
  onSelectionChange?: (task: Task, selected: boolean) => void;
  showSelectionControl?: boolean;
  showToggleControl?: boolean;
  compact?: boolean;
  isCompletedSection?: boolean;
  isDeleting?: boolean;
  isToggling?: boolean;
  isTogglingActive?: boolean;
  isSelected?: boolean;
}

function TaskItemComponent({
  task,
  onToggle,
  onDelete,
  onEdit,
  onToggleActive,
  onSelectionChange,
  showSelectionControl = false,
  showToggleControl = false,
  compact,
  isDeleting = false,
  isToggling = false,
  isTogglingActive = false,
  isSelected = false,
}: TaskItemProps) {
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [actionsOpen, setActionsOpen] = React.useState(false);

  const safeDate = () => {
    try {
      return parseISO(task.dueDate);
    } catch {
      return new Date();
    }
  };

  const date = safeDate();
  const isDraft = task.status === 'draft';
  const isInactive = task.status === 'inactive';
  const isOverdue = isPast(date) && task.status === 'pending';
  const isCompleted = task.status === 'completed';
  const isBusy = isDeleting || isToggling || isTogglingActive;
  const canToggleActive = Boolean(onToggleActive) && !isDraft && !isCompleted;
  const timeLabel = getTaskTimeLabel(task.dueDate);
  const endTimeLabel = task.endDate ? getTaskTimeLabel(task.endDate) : null;
  const timeRangeLabel = timeLabel && endTimeLabel ? `${timeLabel} - ${endTimeLabel}` : timeLabel;
  const timeDescription = getTaskTimeDescription(task.dueDate);
  const overdueKind = isOverdue ? (timeLabel ? 'timed' : 'all-day') : 'none';
  const visibleTags = compact ? (task.tags?.slice(0, 1) ?? []) : (task.tags ?? []);
  const statusLabel = isDraft ? 'Rascunho' : isInactive ? 'Desativado' : isCompleted ? 'Concluído' : isOverdue ? 'Atrasado' : 'Pendente';
  const statusToneClass = isCompleted
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
    : isDraft
      ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300'
    : isInactive
      ? 'border-slate-300 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/[0.07] dark:text-slate-300'
    : overdueKind === 'timed'
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
      : overdueKind === 'all-day'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
        : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300';
  const cardToneClass = isCompleted
    ? 'border-slate-200/70 bg-slate-50/88 dark:border-white/10 dark:bg-white/[0.035]'
    : isDraft
      ? 'border-violet-200/80 bg-gradient-to-br from-white via-violet-50/72 to-white shadow-[0_24px_58px_-38px_rgba(124,58,237,0.32)] dark:border-violet-500/25 dark:from-violet-950/18 dark:via-slate-950/80 dark:to-slate-950/70'
    : isInactive
      ? 'border-slate-200/80 bg-gradient-to-br from-white via-slate-50/80 to-white opacity-90 dark:border-white/10 dark:from-slate-950/74 dark:via-slate-950/68 dark:to-white/[0.025]'
    : overdueKind === 'timed'
      ? 'border-rose-200/90 bg-gradient-to-br from-white via-rose-50/88 to-white shadow-[0_24px_58px_-38px_rgba(244,63,94,0.42)] dark:border-rose-500/25 dark:from-rose-950/22 dark:via-slate-950/80 dark:to-slate-950/70'
      : overdueKind === 'all-day'
        ? 'border-amber-200/90 bg-gradient-to-br from-white via-amber-50/82 to-white shadow-[0_24px_58px_-38px_rgba(245,158,11,0.36)] dark:border-amber-500/25 dark:from-amber-950/18 dark:via-slate-950/80 dark:to-slate-950/70'
        : 'border-slate-200/80 bg-gradient-to-br from-white via-white to-slate-50/88 dark:border-white/10 dark:from-slate-950/78 dark:via-slate-950/68 dark:to-white/[0.035]';

  const formatDate = () => {
    try {
      if (isToday(date)) return 'Hoje';
      if (isTomorrow(date)) return 'Amanhã';
      return format(date, "dd 'de' MMM", { locale: ptBR });
    } catch {
      return '--';
    }
  };

  React.useEffect(() => {
    if (!actionsOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setActionsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [actionsOpen]);

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
        'group relative flex items-start gap-3 overflow-hidden rounded-[26px] border p-3 shadow-[0_18px_52px_-38px_rgba(15,23,42,0.55)] backdrop-blur-xl transition-all sm:gap-4 sm:p-4 md:p-5',
        'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-white/80 before:content-[""] dark:before:bg-white/10',
        !(showSelectionControl || showToggleControl) && 'pl-7 sm:pl-8 md:pl-9',
        cardToneClass,
        isBusy && 'opacity-75',
        !isBusy && 'cursor-pointer hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_22px_62px_-36px_rgba(15,23,42,0.62)] dark:hover:border-white/20',
        isSelected && 'ring-4 ring-blue-500/12 dark:ring-blue-400/12',
      )}
    >
      <div
        className={cn(
          'absolute inset-y-3 left-3 w-1.5 rounded-full bg-gradient-to-b shadow-[0_0_18px_rgba(15,23,42,0.12)] sm:inset-y-4',
          PRIORITY_ACCENTS[task.priority],
        )}
      />

      {(showSelectionControl || showToggleControl) && (
        <div className="ml-1 mt-0.5 flex shrink-0 items-center gap-2 sm:ml-3">
          {showSelectionControl && (
            <button
              type="button"
              aria-label={isSelected ? `Remover ${task.title} da seleção` : `Selecionar lembrete ${task.title}`}
              aria-pressed={isSelected}
              onClick={(event) => {
                event.stopPropagation();
                onSelectionChange?.(task, !isSelected);
              }}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-all sm:h-11 sm:w-11',
                isSelected
                  ? 'border-blue-500 bg-blue-600 text-white shadow-[0_18px_34px_-22px_rgba(37,99,235,0.75)]'
                  : 'border-slate-200 bg-white/90 text-slate-400 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-500 dark:hover:border-blue-400/30 dark:hover:bg-blue-500/10 dark:hover:text-blue-300',
              )}
            >
              {isSelected ? <Check size={18} /> : <div className="h-4 w-4 rounded-md border border-current/70" />}
            </button>
          )}

          {showToggleControl && (
            <button
              data-testid="task-toggle"
              disabled={isBusy}
              aria-label={isCompleted ? `Reabrir lembrete ${task.title}` : `Concluir lembrete ${task.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(task);
              }}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-all disabled:cursor-wait disabled:opacity-60 sm:h-11 sm:w-11',
                isCompleted
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : 'border-slate-200 bg-white/90 text-slate-400 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 hover:shadow-[0_18px_34px_-24px_rgba(16,185,129,0.8)] dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:border-emerald-400/30 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300',
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
          )}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2.5 sm:gap-4">
          <div className="min-w-0">
            <div className={cn('mb-2 flex flex-wrap items-center gap-2', compact && 'mb-1.5 gap-1.5')}>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold',
                  compact && 'px-2 py-0.5 text-[10px]',
                  statusToneClass,
                )}
              >
                {isDraft ? <FileText size={12} /> : isInactive ? <BellOff size={12} /> : isCompleted ? <CheckCircle2 size={12} /> : isOverdue ? <AlertTriangle size={12} /> : <Circle size={12} />}
                {statusLabel}
              </span>

              {!isCompleted && (
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase',
                    compact && 'px-2 py-0.5 text-[10px]',
                    PRIORITY_COLORS[task.priority],
                  )}
                >
                  {PRIORITY_LABELS[task.priority]}
                </span>
              )}
            </div>

            <div className="flex items-start gap-2">
              <h3
                className={cn(
                  compact ? 'line-clamp-2 text-[13px] font-semibold leading-5 sm:text-[15px]' : 'truncate text-[15px] font-semibold sm:text-base',
                  isCompleted
                    ? 'text-slate-400 line-through dark:text-slate-500'
                    : 'text-slate-900 dark:text-white',
                )}
              >
                {task.title}
              </h3>
              {!compact && (
                <span
                  aria-hidden="true"
                  className="icon-slot h-7 w-7 rounded-xl border border-slate-200 bg-white text-slate-400 transition-colors group-hover:border-blue-200 group-hover:text-blue-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-500 dark:group-hover:border-blue-400/20 dark:group-hover:text-blue-300"
                >
                  <PencilLine size={14} />
                </span>
              )}
            </div>
            {!compact && task.description && (
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {task.description}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {canToggleActive && (
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  data-testid="task-actions-button"
                  disabled={isBusy}
                  aria-label={`Abrir ações do lembrete ${task.title}`}
                  aria-expanded={actionsOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    setActionsOpen((current) => !current);
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white/85 text-slate-400 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:border-blue-500/20 dark:hover:bg-blue-500/10 dark:hover:text-blue-300"
                >
                  {isTogglingActive ? <Loader2 size={16} className="animate-spin" /> : <EllipsisVertical size={18} />}
                </button>

                {actionsOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-12 z-30 w-52 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.48)] dark:border-white/10 dark:bg-slate-950"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="task-activation-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActionsOpen(false);
                        onToggleActive?.(task);
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.08]"
                    >
                      {isInactive ? <Bell size={16} /> : <BellOff size={16} />}
                      {isInactive ? 'Ativar lembrete' : 'Desativar lembrete'}
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              data-testid="task-delete"
              disabled={isBusy}
              aria-label={`Excluir lembrete ${task.title}`}
              onClick={(event) => onDelete(task.id, event)}
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-all disabled:cursor-wait md:opacity-0 md:group-hover:opacity-100',
                isDeleting
                  ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
                  : 'border-slate-200 bg-white/85 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:border-rose-500/20 dark:hover:bg-rose-500/10 dark:hover:text-rose-300',
              )}
            >
              {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            </button>
          </div>
        </div>

        <div className={cn('mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200/60 pt-3 dark:border-white/10', compact && 'gap-1.5 pt-2')}>
          <span
            className={cn(
              'inline-flex max-w-[96px] items-center gap-1 truncate rounded-full border border-slate-200 bg-white/85 px-2 py-1 text-[10px] font-semibold text-slate-600 sm:max-w-[120px] sm:px-2.5 sm:text-[11px] dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300',
              compact && 'hidden sm:inline-flex',
            )}
          >
            <Tag size={12} />
            {task.category || 'Geral'}
          </span>

          {visibleTags.map((item) => (
            <span
              key={item}
              className={cn(
                'inline-flex max-w-[88px] items-center gap-1 truncate rounded-full border border-blue-200 bg-blue-50/90 px-2 py-1 text-[10px] font-semibold text-blue-700 sm:max-w-[120px] sm:px-2.5 sm:text-[11px] dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300',
                compact && 'hidden sm:inline-flex',
              )}
            >
              <Tag size={12} />
              {item}
            </span>
          ))}

          {compact && (task.tags?.length ?? 0) > 1 && (
            <span className="hidden items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500 sm:inline-flex sm:px-2.5 sm:text-[11px] dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-400">
              +{(task.tags?.length ?? 0) - 1}
            </span>
          )}

          <span
            data-testid="task-due-badge"
            data-overdue-kind={overdueKind}
            title={timeDescription}
            aria-label={`${formatDate()} - ${timeDescription}`}
            className={cn(
              'ml-auto inline-flex max-w-[98px] items-center gap-1 truncate rounded-full border px-2 py-1 text-[10px] font-bold sm:max-w-none sm:px-2.5 sm:text-[11px]',
              compact && 'max-w-[84px] px-2 py-0.5',
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

          {timeRangeLabel && !compact && (
            <span
              data-testid="task-time-badge"
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold',
                isOverdue
                  ? 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/15 dark:text-rose-300'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300',
              )}
            >
              {timeRangeLabel}
            </span>
          )}

          {overdueKind === 'all-day' && !compact && (
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

          {isTogglingActive && (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
              <Loader2 size={12} className="animate-spin" />
              {isInactive ? 'Ativando' : 'Desativando'}
            </span>
          )}

          {task.syncStatus === 'pending' && (
            <span
              data-testid="task-sync-pending"
              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
            >
              <Loader2 size={12} className="animate-spin" />
              Offline
            </span>
          )}

          {task.externalCalendarSyncStatus === 'failed' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              Calendário pendente
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
    JSON.stringify(prev.task.tags ?? []) === JSON.stringify(next.task.tags ?? []) &&
    prev.task.status === next.task.status &&
    prev.task.syncStatus === next.task.syncStatus &&
    prev.task.externalCalendarSyncStatus === next.task.externalCalendarSyncStatus &&
    prev.task.externalCalendarLastError === next.task.externalCalendarLastError &&
    prev.showSelectionControl === next.showSelectionControl &&
    prev.showToggleControl === next.showToggleControl &&
    prev.compact === next.compact &&
    prev.isDeleting === next.isDeleting &&
    prev.isToggling === next.isToggling &&
    prev.isSelected === next.isSelected,
);

