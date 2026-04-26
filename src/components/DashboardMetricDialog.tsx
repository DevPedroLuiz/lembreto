import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, X } from 'lucide-react';
import { TaskItem } from './TaskItem';
import type { Task } from '../types';

interface DashboardMetricDialogProps {
  open: boolean;
  title: string;
  description: string;
  tasks: Task[];
  countLabel: string;
  onClose: () => void;
  onOpenAll?: () => void;
  onToggle: (task: Task) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
  onEdit: (task: Task) => void;
  deletingTaskIds?: ReadonlySet<string>;
  togglingTaskIds?: ReadonlySet<string>;
}

export function DashboardMetricDialog({
  open,
  title,
  description,
  tasks,
  countLabel,
  onClose,
  onOpenAll,
  onToggle,
  onDelete,
  onEdit,
  deletingTaskIds,
  togglingTaskIds,
}: DashboardMetricDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[130] bg-slate-950/60 backdrop-blur-sm"
          />

          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', damping: 26, stiffness: 260 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-metric-dialog-title"
            className="fixed inset-x-4 top-1/2 z-[131] mx-auto flex max-h-[86vh] w-full max-w-4xl -translate-y-1/2 flex-col overflow-hidden rounded-[32px] border border-slate-200/80 bg-white/96 shadow-[0_36px_120px_-42px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94"
            data-testid="dashboard-metric-dialog"
          >
            <div className="border-b border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="section-eyebrow">{countLabel}</span>
                  <h2
                    id="dashboard-metric-dialog-title"
                    className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white"
                  >
                    {title}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                    {description}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar visão filtrada"
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-7">
              {tasks.length > 0 ? (
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onToggle={onToggle}
                      onDelete={onDelete}
                      onEdit={onEdit}
                      compact
                      isDeleting={deletingTaskIds?.has(task.id)}
                      isToggling={togglingTaskIds?.has(task.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 px-6 py-16 text-center dark:border-white/10 dark:bg-white/[0.03]">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Nenhum lembrete encontrado
                  </h3>
                  <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
                    Não há itens para exibir neste recorte agora.
                  </p>
                </div>
              )}
            </div>

            {onOpenAll && (
              <div className="border-t border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
                <button
                  type="button"
                  onClick={onOpenAll}
                  className="action-secondary ml-auto"
                  data-testid="dashboard-metric-open-all"
                >
                  Ver em Meus lembretes
                  <span className="icon-slot h-4 w-4">
                    <ArrowRight size={16} />
                  </span>
                </button>
              </div>
            )}
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
