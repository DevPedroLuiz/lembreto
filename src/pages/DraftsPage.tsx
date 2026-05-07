import React from 'react';
import { FileText, Loader2, PencilLine, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { TaskItem } from '../components/TaskItem';
import type { Task } from '../types';

interface DraftsPageProps {
  drafts: Task[];
  onNewTask: () => void;
  onEdit: (task: Task) => void;
  onPromote: (task: Task) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
  deletingTaskIds?: ReadonlySet<string>;
  promotingDraftIds?: ReadonlySet<string>;
}

export function DraftsPage({
  drafts,
  onNewTask,
  onEdit,
  onPromote,
  onDelete,
  deletingTaskIds,
  promotingDraftIds,
}: DraftsPageProps) {
  return (
    <section className="surface-panel p-5 md:p-6">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <span className="section-eyebrow">
            <FileText size={14} />
            Rascunhos
          </span>
          <h3 className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">Lembretes em rascunho</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {drafts.length} rascunho{drafts.length === 1 ? '' : 's'} aguardando revisão.
          </p>
        </div>

        <button type="button" onClick={onNewTask} className="action-primary">
          <Plus size={18} />
          Novo rascunho
        </button>
      </div>

      <AnimatePresence>
        {drafts.length > 0 ? (
          <div className="space-y-4">
            {drafts.map((draft) => {
              const isPromoting = promotingDraftIds?.has(draft.id) ?? false;

              return (
                <motion.div key={draft.id} layout className="space-y-3">
                  <TaskItem
                    task={draft}
                    onToggle={() => undefined}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    isDeleting={deletingTaskIds?.has(draft.id)}
                  />

                  <div className="grid gap-2 sm:flex sm:justify-end">
                    <button
                      type="button"
                      data-testid="draft-edit-button"
                      onClick={() => onEdit(draft)}
                      disabled={isPromoting}
                      className="action-secondary justify-center disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <PencilLine size={16} />
                      Editar
                    </button>
                    <button
                      type="button"
                      data-testid="draft-promote-button"
                      onClick={() => onPromote(draft)}
                      disabled={isPromoting}
                      className="action-primary justify-center disabled:cursor-wait disabled:opacity-70"
                    >
                      {isPromoting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                      Adicionar como lembrete
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/70 px-6 py-16 text-center dark:border-white/10 dark:bg-white/[0.03]"
          >
            <FileText size={34} className="mx-auto mb-4 text-slate-400" />
            <h4 className="text-lg font-semibold text-slate-900 dark:text-white">Nenhum rascunho salvo</h4>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Salve um lembrete como rascunho para revisar antes de publicar.
            </p>
            <button type="button" onClick={onNewTask} className="action-primary mt-6">
              Criar rascunho
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
