import React from 'react';
import {
  Clock3,
  Link2,
  PencilLine,
  Pin,
  RotateCcw,
  Tag,
  Trash2,
} from 'lucide-react';
import { cn } from '../lib/cn';
import type { Note, Task } from '../types';

const PRIORITY_LABELS = {
  low: 'Baixa',
  medium: 'Media',
  high: 'Alta',
} as const;

const PRIORITY_STYLES = {
  low: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  high: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300',
} as const;

export interface NoteCardProps {
  note: Note;
  linkedTask?: Task | null;
  compact?: boolean;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  onRestore?: (note: Note) => void;
  showDeletedMeta?: boolean;
}

export const NoteCard: React.FC<NoteCardProps> = ({
  note,
  linkedTask,
  compact = false,
  onEdit,
  onDelete,
  onRestore,
  showDeletedMeta = false,
}) => {
  const expiresAtLabel = note.expiresAt
    ? new Date(note.expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;
  const deleteAfterLabel = note.deleteAfter
    ? new Date(note.deleteAfter).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;

  return (
    <article
      data-testid="note-card"
      data-note-title={note.title}
      className={cn(
        'rounded-[28px] border border-slate-200/80 bg-white/90 p-5 transition-all dark:border-white/10 dark:bg-white/[0.04]',
        compact ? 'p-4' : 'hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-white/20',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${PRIORITY_STYLES[note.priority]}`}
            >
              {PRIORITY_LABELS[note.priority]}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
              {note.mode === 'fixed' ? <Pin size={12} /> : <Clock3 size={12} />}
              {note.mode === 'fixed' ? 'Fixa' : 'Temporária'}
            </span>
            {expiresAtLabel && !showDeletedMeta && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                <Clock3 size={12} />
                Até {expiresAtLabel}
              </span>
            )}
            {showDeletedMeta && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                <Trash2 size={12} />
                {note.deletionReason === 'expired' ? 'Vencida' : 'Na lixeira'}
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
              <Tag size={12} />
              {note.category}
            </span>
          </div>

          <div className="mt-4">
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">{note.title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-500 dark:text-slate-400">
              {note.content.trim() || 'Sem anotações adicionais.'}
            </p>
          </div>

          {(note.tags.length > 0 || linkedTask) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {note.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
                >
                  <Tag size={12} />
                  {tag}
                </span>
              ))}
              {linkedTask && (
                <span
                  data-testid="note-linked-task"
                  className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300"
                >
                  <Link2 size={12} />
                  {linkedTask.title}
                </span>
              )}
            </div>
          )}

          {showDeletedMeta && deleteAfterLabel && (
            <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              Esta nota será excluída permanentemente em {deleteAfterLabel}.
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {showDeletedMeta ? (
            <button
              type="button"
              data-testid="note-restore-button"
              onClick={() => onRestore?.(note)}
              aria-label={`Reativar nota ${note.title}`}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15"
            >
              <RotateCcw size={16} />
            </button>
          ) : (
            <>
          <button
            type="button"
            data-testid="note-edit-button"
            onClick={() => onEdit(note)}
            aria-label={`Editar nota ${note.title}`}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
          >
            <PencilLine size={16} />
          </button>
          <button
            type="button"
            data-testid="note-delete-button"
            onClick={() => onDelete(note)}
            aria-label={`Excluir nota ${note.title}`}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15"
          >
            <Trash2 size={16} />
          </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
};
