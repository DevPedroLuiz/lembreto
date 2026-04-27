import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  CopyPlus,
  PencilLine,
  Share2,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getTaskTimeDescription, getTaskTimeLabel } from '../lib/taskDueDate';
import type { Priority, Task } from '../types';

const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};

const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  high: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300',
};

interface TaskDetailsDialogProps {
  open: boolean;
  task: Task | null;
  isDeleting?: boolean;
  isToggling?: boolean;
  isRescheduling?: boolean;
  backLabel?: string;
  onClose: () => void;
  onBack?: () => void;
  onEdit: (task: Task) => void;
  onDuplicate: (task: Task) => void;
  onShare: (task: Task) => void;
  onQuickReschedule: (task: Task, preset: 'laterToday' | 'tomorrowMorning' | 'nextWeek') => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
}

function formatDueDate(task: Task): string {
  try {
    return format(parseISO(task.dueDate), "EEEE, dd 'de' MMMM", { locale: ptBR });
  } catch {
    return 'Data indisponível';
  }
}

function formatCreatedAt(task: Task): string {
  try {
    return format(parseISO(task.createdAt), "dd 'de' MMM 'às' HH:mm", { locale: ptBR });
  } catch {
    return 'Registro recente';
  }
}

export function TaskDetailsDialog({
  open,
  task,
  isDeleting = false,
  isToggling = false,
  isRescheduling = false,
  backLabel,
  onClose,
  onBack,
  onEdit,
  onDuplicate,
  onShare,
  onQuickReschedule,
  onToggle,
  onDelete,
}: TaskDetailsDialogProps) {
  if (!task) return null;

  const timeLabel = getTaskTimeLabel(task.dueDate);
  const timeDescription = getTaskTimeDescription(task.dueDate);
  const isCompleted = task.status === 'completed';
  const isBusy = isDeleting || isToggling || isRescheduling;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (!isBusy) onClose();
            }}
            className="fixed inset-0 z-[110] bg-slate-950/60 backdrop-blur-sm"
          />

          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', damping: 26, stiffness: 260 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-details-title"
            className="fixed inset-x-4 top-1/2 z-[111] mx-auto flex max-h-[88vh] w-full max-w-4xl -translate-y-1/2 flex-col overflow-hidden rounded-[32px] border border-slate-200/80 bg-white/96 shadow-[0_36px_120px_-42px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94"
            data-testid="task-details-dialog"
          >
            <div className="border-b border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {onBack && backLabel && (
                      <button
                        type="button"
                        onClick={onBack}
                        disabled={isBusy}
                        data-testid="task-details-back"
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                      >
                        <ArrowLeft size={14} />
                        {backLabel}
                      </button>
                    )}

                    <span className="section-eyebrow">
                      <span className="icon-slot h-4 w-4">
                        <CalendarDays size={14} />
                      </span>
                      Visão do lembrete
                    </span>
                  </div>
                  <h2
                    id="task-details-title"
                    className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white"
                  >
                    {task.title}
                  </h2>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Criado em {formatCreatedAt(task)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  disabled={isBusy}
                  aria-label="Fechar visualização do lembrete"
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-7">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_340px]">
                <section className="surface-soft p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${PRIORITY_STYLES[task.priority]}`}>
                      {PRIORITY_LABELS[task.priority]}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
                      <Tag size={12} />
                      {task.category || 'Geral'}
                    </span>
                    <span
                      className={[
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                        isCompleted
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                          : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300',
                      ].join(' ')}
                    >
                      {isCompleted ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                      {isCompleted ? 'Concluído' : 'Pendente'}
                    </span>
                  </div>

                  <div className="mt-5 space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Descrição</h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-500 dark:text-slate-400">
                        {task.description?.trim() || 'Nenhum detalhe adicional foi registrado para este lembrete.'}
                      </p>
                    </div>

                    <div className="rounded-[28px] border border-slate-200/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                      <div className="flex items-center gap-2">
                        <span className="icon-slot h-9 w-9 rounded-2xl bg-slate-100 text-slate-600 dark:bg-white/[0.07] dark:text-slate-300">
                          <CalendarClock size={16} />
                        </span>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Histórico rápido</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Um resumo objetivo para situar este lembrete.
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3">
                        <div className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                          <span className="icon-slot mt-0.5 h-8 w-8 rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                            <Sparkles size={14} />
                          </span>
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                              Registro criado
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                              {formatCreatedAt(task)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                          <span className="icon-slot mt-0.5 h-8 w-8 rounded-xl bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                            <CalendarDays size={14} />
                          </span>
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                              Prazo definido
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                              {formatDueDate(task)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {timeDescription}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                          <span
                            className={[
                              'icon-slot mt-0.5 h-8 w-8 rounded-xl',
                              isCompleted
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                                : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
                            ].join(' ')}
                          >
                            {isCompleted ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                          </span>
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                              Situação atual
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                              {isCompleted ? 'Concluído e arquivado na sua história' : 'Pendente e pronto para receber uma ação'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <aside className="space-y-4">
                  <section className="surface-soft p-5">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Prazo</h3>
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
                        <span className="icon-slot h-10 w-10 rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                          <CalendarDays size={18} />
                        </span>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                            Data
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                            {formatDueDate(task)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
                        <span className="icon-slot h-10 w-10 rounded-2xl bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                          <Clock3 size={18} />
                        </span>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                            Horário
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                            {timeLabel || 'Dia todo'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {timeDescription}
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>

                  {!isCompleted && (
                    <section className="surface-soft p-5">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Ajustes rápidos</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        Quando a rotina muda, você consegue adiar este lembrete sem entrar na edição completa.
                      </p>

                      <div className="mt-4 grid gap-3">
                        <button
                          type="button"
                          data-testid="task-details-snooze-later"
                          onClick={() => onQuickReschedule(task, 'laterToday')}
                          disabled={isBusy}
                          className="action-secondary w-full justify-between disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Clock3 size={18} />
                            Mais tarde hoje
                          </span>
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            +2 horas
                          </span>
                        </button>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            data-testid="task-details-snooze-tomorrow"
                            onClick={() => onQuickReschedule(task, 'tomorrowMorning')}
                            disabled={isBusy}
                            className="action-secondary w-full disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <CalendarDays size={18} />
                            Amanhã cedo
                          </button>

                          <button
                            type="button"
                            data-testid="task-details-snooze-next-week"
                            onClick={() => onQuickReschedule(task, 'nextWeek')}
                            disabled={isBusy}
                            className="action-secondary w-full disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <CalendarClock size={18} />
                            Próxima semana
                          </button>
                        </div>
                      </div>
                    </section>
                  )}

                  <section className="surface-soft p-5">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Ações</h3>
                    <div className="mt-4 grid gap-3">
                      <button
                        type="button"
                        data-testid="task-details-edit"
                        onClick={() => onEdit(task)}
                        disabled={isBusy}
                        className="action-primary w-full disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        <PencilLine size={18} />
                        Editar lembrete
                      </button>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          data-testid="task-details-duplicate"
                          onClick={() => onDuplicate(task)}
                          disabled={isBusy}
                          className="action-secondary w-full disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          <CopyPlus size={18} />
                          Duplicar
                        </button>

                        <button
                          type="button"
                          data-testid="task-details-share"
                          onClick={() => onShare(task)}
                          disabled={isBusy}
                          className="action-secondary w-full disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          <Share2 size={18} />
                          Compartilhar
                        </button>
                      </div>

                      <button
                        type="button"
                        data-testid="task-details-toggle"
                        onClick={() => onToggle(task)}
                        disabled={isBusy}
                        className="action-secondary w-full disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isCompleted ? <Circle size={18} /> : <CheckCircle2 size={18} />}
                        {isCompleted ? 'Reabrir lembrete' : 'Marcar como concluído'}
                      </button>

                      <button
                        type="button"
                        data-testid="task-details-delete"
                        onClick={() => onDelete(task)}
                        disabled={isBusy}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 font-semibold text-rose-700 transition-all hover:-translate-y-0.5 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15"
                      >
                        <Trash2 size={18} />
                        Excluir lembrete
                      </button>
                    </div>
                  </section>
                </aside>
              </div>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
