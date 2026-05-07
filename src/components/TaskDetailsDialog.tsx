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
  Loader2,
  PencilLine,
  RefreshCw,
  Share2,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getTaskTimeDescription, getTaskTimeLabel } from '../lib/taskDueDate';
import { NoteCard } from './NoteCard';
import type { Note, Priority, Task, TaskHistoryEvent } from '../types';

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
  linkedNotes?: Note[];
  isDeleting?: boolean;
  isToggling?: boolean;
  isRescheduling?: boolean;
  isSyncingCalendar?: boolean;
  backLabel?: string;
  onClose: () => void;
  onBack?: () => void;
  onEdit: (task: Task) => void;
  onDuplicate: (task: Task) => void;
  onShare: (task: Task) => void;
  onSyncCalendar: (task: Task) => void;
  onQuickReschedule: (task: Task, preset: 'laterToday' | 'tomorrowMorning' | 'nextWeek') => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onCreateLinkedNote: (task: Task) => void;
  onEditLinkedNote: (note: Note, task: Task) => void;
  onDeleteLinkedNote: (note: Note) => void;
}

function formatDueDate(task: Task): string {
  try {
    return format(parseISO(task.dueDate), "EEEE, dd 'de' MMMM", { locale: ptBR });
  } catch {
    return 'Data indisponível';
  }
}

function formatHistoryDate(value: string): string {
  try {
    return format(parseISO(value), "dd 'de' MMM 'às' HH:mm", { locale: ptBR });
  } catch {
    return 'Agora';
  }
}

function buildTaskHistory(task: Task): TaskHistoryEvent[] {
  const savedHistory = Array.isArray(task.history) ? task.history : [];

  if (savedHistory.length > 0) {
    return [...savedHistory].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  return [
    {
      id: `${task.id}-created`,
      action: 'created',
      title: 'Lembrete criado',
      description: 'Registro inicial importado para o histórico.',
      createdAt: task.createdAt,
      details: [
        `Prazo atual: ${formatDueDate(task)}.`,
        task.status === 'completed' ? 'Situação atual: concluído.' : 'Situação atual: pendente.',
      ],
    },
  ];
}

function getHistoryIcon(event: TaskHistoryEvent) {
  switch (event.action) {
    case 'completed':
      return <CheckCircle2 size={14} />;
    case 'reopened':
      return <Circle size={14} />;
    case 'rescheduled':
      return <CalendarDays size={14} />;
    case 'updated':
      return <PencilLine size={14} />;
    case 'created':
    default:
      return <Sparkles size={14} />;
  }
}

function getHistoryTone(event: TaskHistoryEvent): string {
  switch (event.action) {
    case 'completed':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'reopened':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300';
    case 'rescheduled':
      return 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300';
    case 'updated':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300';
    case 'created':
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-white/[0.07] dark:text-slate-300';
  }
}

export function TaskDetailsDialog({
  open,
  task,
  linkedNotes = [],
  isDeleting = false,
  isToggling = false,
  isRescheduling = false,
  isSyncingCalendar = false,
  backLabel,
  onClose,
  onBack,
  onEdit,
  onDuplicate,
  onShare,
  onSyncCalendar,
  onQuickReschedule,
  onToggle,
  onDelete,
  onCreateLinkedNote,
  onEditLinkedNote,
  onDeleteLinkedNote,
}: TaskDetailsDialogProps) {
  if (!task) return null;

  const timeLabel = getTaskTimeLabel(task.dueDate);
  const timeDescription = getTaskTimeDescription(task.dueDate);
  const isCompleted = task.status === 'completed';
  const isBusy = isDeleting || isToggling || isRescheduling || isSyncingCalendar;
  const historyItems = buildTaskHistory(task);

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
            className="fixed inset-0 z-[110] bg-slate-950/60 backdrop-blur-sm lg:left-[320px]"
          />

          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', damping: 26, stiffness: 260 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-details-title"
            className="fixed inset-x-3 bottom-3 top-auto z-[111] mx-auto flex max-h-[86dvh] w-auto flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/96 shadow-[0_36px_120px_-42px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94 sm:inset-x-4 sm:top-1/2 sm:bottom-auto sm:max-h-[88vh] sm:w-full sm:max-w-5xl sm:-translate-y-1/2 sm:rounded-[32px] lg:left-[316px] lg:right-6 lg:mx-0 lg:w-auto lg:max-w-none xl:left-[344px]"
            data-testid="task-details-dialog"
          >
            <div className="relative overflow-hidden border-b border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-blue-50/70 px-5 pb-6 pt-5 dark:border-white/10 dark:from-slate-950 dark:via-slate-950 dark:to-blue-950/20 md:px-7 md:pb-7 md:pt-6">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/90 dark:bg-white/10" />

              <div className="flex flex-col gap-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 pr-12 xl:pr-0">
                    {onBack && backLabel && (
                      <button
                        type="button"
                        onClick={onBack}
                        disabled={isBusy}
                        data-testid="task-details-back"
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
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

                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isBusy}
                    aria-label="Fechar visualização do lembrete"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white/86 text-slate-500 shadow-[0_16px_36px_-28px_rgba(15,23,42,0.55)] transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                  <div className="min-w-0">

                  <h2
                    id="task-details-title"
                    className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-3xl"
                  >
                    {task.title}
                  </h2>

                  <div className="mt-4 flex flex-wrap items-center gap-2 pb-1">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase ${PRIORITY_STYLES[task.priority]}`}>
                      {PRIORITY_LABELS[task.priority]}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/75 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
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
                </div>

                  <div className="flex max-w-[640px] flex-wrap justify-start gap-2 xl:justify-end">
                    <button
                      type="button"
                      data-testid="task-details-edit"
                      onClick={() => onEdit(task)}
                      disabled={isBusy}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 px-4 text-sm font-semibold text-white shadow-[0_16px_28px_-20px_rgba(37,99,235,0.72)] transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <PencilLine size={16} />
                      Editar
                    </button>

                    <button
                      type="button"
                      data-testid="task-details-toggle"
                      onClick={() => onToggle(task)}
                      disabled={isBusy}
                      className={[
                        'inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-3.5 text-sm font-semibold transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70',
                        isCompleted
                          ? 'border-slate-200 bg-white/78 text-slate-700 hover:bg-white dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.08]'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[0_16px_30px_-22px_rgba(16,185,129,0.75)] hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-800 hover:shadow-[0_20px_36px_-24px_rgba(16,185,129,0.9)] dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:border-emerald-400/30 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-200',
                      ].join(' ')}
                    >
                      {isCompleted ? <Circle size={16} /> : <CheckCircle2 size={16} />}
                      {isCompleted ? 'Reabrir' : 'Concluir'}
                    </button>

                    <button
                      type="button"
                      data-testid="task-details-share"
                      onClick={() => onShare(task)}
                      disabled={isBusy}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/78 px-3.5 text-sm font-semibold text-slate-700 transition-all hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.08]"
                    >
                      <Share2 size={16} />
                      Compartilhar
                    </button>

                    <button
                      type="button"
                      data-testid="task-details-calendar-sync"
                      onClick={() => onSyncCalendar(task)}
                      disabled={isBusy}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/78 px-3.5 text-sm font-semibold text-slate-700 transition-all hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.08]"
                    >
                      {isSyncingCalendar ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      Sincronizar agora
                    </button>

                    <button
                      type="button"
                      data-testid="task-details-duplicate"
                      onClick={() => onDuplicate(task)}
                      disabled={isBusy}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/78 px-3.5 text-sm font-semibold text-slate-700 transition-all hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.08]"
                    >
                      <CopyPlus size={16} />
                      Duplicar
                    </button>

                    <button
                      type="button"
                      data-testid="task-details-delete"
                      onClick={() => onDelete(task)}
                      disabled={isBusy}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 text-sm font-semibold text-rose-700 transition-all hover:-translate-y-0.5 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15"
                    >
                      <Trash2 size={16} />
                      Excluir
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50/45 px-5 py-5 dark:bg-white/[0.015] md:px-7 md:py-6">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <section className="surface-soft overflow-hidden p-0">
                  <div className="border-b border-slate-200/70 bg-white/70 px-5 py-4 dark:border-white/10 dark:bg-white/[0.03]">
                    <h3 className="text-base font-semibold text-slate-950 dark:text-white">
                      Detalhes do lembrete
                    </h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Contexto, prazo e histórico reunidos em um só lugar.
                    </p>
                  </div>

                  <div className="space-y-4 p-5">
                    <div className="rounded-[28px] border border-slate-200/80 bg-white/82 p-5 dark:border-white/10 dark:bg-white/[0.04]">
                      <div className="flex items-start gap-3">
                        <span className="icon-slot h-10 w-10 rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                          <PencilLine size={17} />
                        </span>
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Descrição</h4>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-500 dark:text-slate-400">
                        {task.description?.trim() || 'Nenhum detalhe adicional foi registrado para este lembrete.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {(task.tags?.length ?? 0) > 0 && (
                      <div className="rounded-[28px] border border-blue-200/70 bg-blue-50/50 p-4 dark:border-blue-500/20 dark:bg-blue-500/10">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700/70 dark:text-blue-300/70">
                          Tags
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {task.tags?.map((item) => (
                            <span
                              key={item}
                              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:border-blue-500/20 dark:bg-white/[0.06] dark:text-blue-300"
                            >
                              <Tag size={12} />
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {task.externalCalendarSyncStatus === 'failed' && task.externalCalendarLastError ? (
                      <div className="rounded-[28px] border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-100">
                        <p className="font-semibold">Falha na sincronização do calendário</p>
                        <p className="mt-2 leading-6">{task.externalCalendarLastError}</p>
                      </div>
                    ) : task.externalCalendarSyncStatus === 'synced' ? (
                      <div className="rounded-[28px] border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-100">
                        Sincronizado com {task.externalCalendarProvider === 'google' ? 'Google Calendar' : 'Outlook Calendar'}.
                      </div>
                    ) : null}

                    <div className="rounded-[28px] border border-slate-200/80 bg-white/82 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                      <div className="flex items-center gap-2">
                        <span className="icon-slot h-9 w-9 rounded-2xl bg-slate-100 text-slate-600 dark:bg-white/[0.07] dark:text-slate-300">
                          <CalendarClock size={16} />
                        </span>
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Histórico rápido</h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Alterações feitas pelo usuário neste lembrete.
                          </p>
                        </div>
                      </div>

                      <div data-testid="task-history-list" className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-1">
                        {historyItems.map((event) => (
                          <div
                            key={event.id}
                            data-testid="task-history-entry"
                            className="flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]"
                          >
                            <span className={`icon-slot mt-0.5 h-8 w-8 rounded-xl ${getHistoryTone(event)}`}>
                              {getHistoryIcon(event)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                  {event.title}
                                </p>
                                <time className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                                  {formatHistoryDate(event.createdAt)}
                                </time>
                              </div>
                              <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                                {event.description}
                              </p>
                              {(event.details?.length ?? 0) > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {event.details?.map((detail) => (
                                    <span
                                      key={detail}
                                      className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
                                    >
                                      {detail}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <aside className="space-y-4">
                  <section className="surface-soft p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Notas vinculadas</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                          Reúna aqui o contexto que pertence a este lembrete.
                        </p>
                      </div>

                      <button
                        type="button"
                        data-testid="task-details-add-note"
                        onClick={() => onCreateLinkedNote(task)}
                        disabled={isBusy}
                        className="action-secondary min-h-[44px] rounded-2xl px-4 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        <PencilLine size={16} />
                        Nova nota
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {linkedNotes.length > 0 ? (
                        linkedNotes.map((note) => (
                          <NoteCard
                            key={note.id}
                            note={note}
                            linkedTask={task}
                            compact
                            onEdit={(currentNote) => onEditLinkedNote(currentNote, task)}
                            onDelete={onDeleteLinkedNote}
                          />
                        ))
                      ) : (
                        <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                          Ainda não existe nenhuma nota vinculada a este lembrete.
                        </div>
                      )}
                    </div>
                  </section>

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
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Reagendar</h3>
                          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Atalhos para mover o prazo sem abrir a edição.
                          </p>
                        </div>
                        {isRescheduling && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                            <Sparkles size={12} />
                            Salvando
                          </span>
                        )}
                      </div>

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
                          <span className="text-xs text-slate-400 dark:text-slate-500">+2 horas</span>
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
                </aside>
              </div>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
