import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarDays, Loader2, X } from 'lucide-react';
import type { Priority, Task } from '../types';
import { CATEGORIES } from '../types';

const TIME_OPTIONS = [
  '',
  ...Array.from({ length: 24 * 2 }, (_, index) => {
    const hours = `${Math.floor(index / 2)}`.padStart(2, '0');
    const minutes = index % 2 === 0 ? '00' : '30';
    return `${hours}:${minutes}`;
  }),
];

interface TaskDrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  editingTask: Task | null;
  darkMode: boolean;
  isSubmitting?: boolean;
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  date: string;
  setDate: (value: string) => void;
  time: string;
  setTime: (value: string) => void;
  dueDateError?: string;
  minimumDate?: string;
  priority: Priority;
  setPriority: (value: Priority) => void;
  category: string;
  setCategory: (value: string) => void;
}

export function TaskDrawer({
  open,
  onClose,
  onSubmit,
  editingTask,
  darkMode,
  isSubmitting = false,
  title,
  setTitle,
  description,
  setDescription,
  date,
  setDate,
  time,
  setTime,
  dueDateError = '',
  minimumDate,
  priority,
  setPriority,
  category,
  setCategory,
}: TaskDrawerProps) {
  const isEditing = Boolean(editingTask);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (!isSubmitting) onClose();
            }}
            className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm dark:bg-black/70"
          />

          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="fixed right-0 top-0 z-[101] flex h-full w-full max-w-xl flex-col border-l border-slate-200/80 bg-white/96 shadow-[0_0_0_1px_rgba(15,23,42,0.02),0_24px_80px_-28px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-drawer-title"
          >
            <div className="border-b border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="section-eyebrow">
                    {isEditing ? 'Atualização' : 'Planejamento'}
                  </span>
                  <h2 id="task-drawer-title" className="mt-4 text-2xl font-semibold text-slate-950 dark:text-white">
                    {isEditing ? 'Editar lembrete' : 'Novo lembrete'}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    Defina título, prazo, prioridade e contexto para manter sua agenda objetiva.
                  </p>
                </div>

                <button
                  onClick={onClose}
                  disabled={isSubmitting}
                  aria-label="Fechar formulário de lembrete"
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-7">
              <form id="task-form" onSubmit={onSubmit} className="space-y-6" aria-busy={isSubmitting}>
                <section className="surface-soft p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Informações principais</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Registre o objetivo do lembrete com clareza.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Título
                      </label>
                      <input
                        autoFocus
                        required
                        type="text"
                        data-testid="task-title-input"
                        placeholder="Ex.: Preparar relatório mensal"
                        value={title}
                        disabled={isSubmitting}
                        onChange={(event) => setTitle(event.target.value)}
                        className="field-control"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Detalhes
                      </label>
                      <textarea
                        placeholder="Inclua contexto, próximos passos ou links úteis."
                        data-testid="task-description-input"
                        value={description}
                        disabled={isSubmitting}
                        onChange={(event) => setDescription(event.target.value)}
                        className="field-control min-h-[140px] resize-none"
                      />
                    </div>
                  </div>
                </section>

                <section className="surface-soft p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Prazo e organização</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Defina quando o lembrete deve acontecer e como ele será classificado.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Prazo
                      </label>
                      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                        <div className="relative">
                          <CalendarDays className="field-icon" size={18} />
                          <input
                            type="date"
                            data-testid="task-date-input"
                            required
                            min={minimumDate}
                            value={date}
                            disabled={isSubmitting}
                            onChange={(event) => setDate(event.target.value)}
                            aria-invalid={dueDateError ? 'true' : 'false'}
                            style={{ colorScheme: darkMode ? 'dark' : 'light' }}
                            className={[
                              'field-control field-control-with-icon',
                              dueDateError
                                ? 'border-rose-300 bg-rose-50/70 text-rose-700 focus:border-rose-400 focus:ring-rose-500/10 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200 dark:focus:border-rose-400'
                                : '',
                            ].join(' ')}
                          />
                        </div>

                        <select
                          value={time}
                          disabled={isSubmitting}
                          data-testid="task-time-select"
                          onChange={(event) => setTime(event.target.value)}
                          className="field-control cursor-pointer"
                        >
                          {TIME_OPTIONS.map((option) => (
                            <option key={option || 'no-time'} value={option}>
                              {option || 'Sem horário'}
                            </option>
                          ))}
                        </select>
                      </div>

                      <p
                        className={[
                          'mt-2 text-sm',
                          dueDateError ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400',
                        ].join(' ')}
                        data-testid="task-date-help"
                      >
                        {dueDateError || 'O horário é opcional. Sem horário, o lembrete vale durante todo o dia.'}
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Prioridade
                        </label>
                        <select
                          value={priority}
                          disabled={isSubmitting}
                          data-testid="task-priority-select"
                          onChange={(event) => setPriority(event.target.value as Priority)}
                          className="field-control cursor-pointer"
                        >
                          <option value="low">Baixa</option>
                          <option value="medium">Média</option>
                          <option value="high">Alta</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Categoria
                        </label>
                        <select
                          value={category}
                          disabled={isSubmitting}
                          data-testid="task-category-select"
                          onChange={(event) => setCategory(event.target.value)}
                          className="field-control cursor-pointer"
                        >
                          {CATEGORIES.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </section>
              </form>
            </div>

            <div className="border-t border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <button
                form="task-form"
                type="submit"
                data-testid="task-submit-button"
                disabled={isSubmitting || Boolean(dueDateError)}
                className="action-primary w-full rounded-2xl py-4 disabled:cursor-wait disabled:opacity-70"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {isEditing ? 'Salvando alterações...' : 'Criando lembrete...'}
                  </>
                ) : isEditing ? (
                  'Salvar alterações'
                ) : (
                  'Adicionar lembrete'
                )}
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
