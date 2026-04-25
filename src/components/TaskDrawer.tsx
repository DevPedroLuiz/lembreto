// src/components/TaskDrawer.tsx
// Slide-in drawer for creating and editing tasks

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CalendarDays, Loader2 } from 'lucide-react';
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
  onSubmit: (e: React.FormEvent) => void;
  editingTask: Task | null;
  darkMode: boolean;
  isSubmitting?: boolean;

  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
  time: string;
  setTime: (v: string) => void;
  priority: Priority;
  setPriority: (v: Priority) => void;
  category: string;
  setCategory: (v: string) => void;
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
  priority,
  setPriority,
  category,
  setCategory,
}: TaskDrawerProps) {
  const isEditing = !!editingTask;

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
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[100]"
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-[#040814] shadow-2xl z-[101] border-l border-slate-200 dark:border-white/10 flex flex-col"
          >
            <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0">
              <h2 className="text-xl font-semibold">
                {isEditing ? 'Editar Tarefa' : 'Nova Tarefa'}
              </h2>
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <form id="task-form" onSubmit={onSubmit} className="space-y-6" aria-busy={isSubmitting}>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Titulo
                  </label>
                  <input
                    autoFocus
                    required
                    type="text"
                    data-testid="task-title-input"
                    placeholder="Ex: Preparar relatorio"
                    value={title}
                    disabled={isSubmitting}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>

                <div className="space-y-4">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Prazo
                  </label>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
                    <div className="relative">
                      <CalendarDays
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                        size={20}
                      />
                      <input
                        type="date"
                        data-testid="task-date-input"
                        required
                        value={date}
                        disabled={isSubmitting}
                        onChange={(e) => setDate(e.target.value)}
                        style={{ colorScheme: darkMode ? 'dark' : 'light' }}
                        className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <select
                      value={time}
                      disabled={isSubmitting}
                      data-testid="task-time-select"
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      {TIME_OPTIONS.map((option) => (
                        <option key={option || 'no-time'} value={option}>
                          {option ? option : 'Sem horario'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Horario e opcional. Sem horario deixa a tarefa valendo ate o fim do dia.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Prioridade
                    </label>
                    <select
                      value={priority}
                      disabled={isSubmitting}
                      data-testid="task-priority-select"
                      onChange={(e) => setPriority(e.target.value as Priority)}
                      className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="low">Baixa</option>
                      <option value="medium">Media</option>
                      <option value="high">Alta</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Categoria
                    </label>
                    <select
                      value={category}
                      disabled={isSubmitting}
                      data-testid="task-category-select"
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Detalhes (Opcional)
                  </label>
                  <textarea
                    placeholder="Notas, links..."
                    data-testid="task-description-input"
                    value={description}
                    disabled={isSubmitting}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 min-h-[120px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </form>
            </div>

            <div className="p-6 border-t border-slate-100 dark:border-white/5 shrink-0">
              <button
                form="task-form"
                type="submit"
                data-testid="task-submit-button"
                disabled={isSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-70 disabled:cursor-wait text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {isEditing ? 'Salvando...' : 'Criando...'}
                  </>
                ) : isEditing ? (
                  'Salvar Alteracoes'
                ) : (
                  'Adicionar Tarefa'
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
