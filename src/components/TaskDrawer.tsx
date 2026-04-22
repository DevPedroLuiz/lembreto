// src/components/TaskDrawer.tsx
// Slide-in drawer for creating and editing tasks

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CalendarDays } from 'lucide-react';
import type { Priority, Task } from '../types';
import { CATEGORIES } from '../types';

interface TaskDrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  editingTask: Task | null;
  darkMode: boolean;

  // Form state
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
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
  title,
  setTitle,
  description,
  setDescription,
  date,
  setDate,
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
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[100]"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-[#040814] shadow-2xl z-[101] border-l border-slate-200 dark:border-white/10 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/5 shrink-0">
              <h2 className="text-xl font-semibold">
                {isEditing ? 'Editar Tarefa' : 'Nova Tarefa'}
              </h2>
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              <form id="task-form" onSubmit={onSubmit} className="space-y-6">
                {/* Title */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Título
                  </label>
                  <input
                    autoFocus
                    required
                    type="text"
                    placeholder="Ex: Preparar relatório"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  />
                </div>

                {/* Due Date */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Prazo
                  </label>
                  <div className="relative">
                    <CalendarDays
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                      size={20}
                    />
                    <input
                      type="datetime-local"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      style={{ colorScheme: darkMode ? 'dark' : 'light' }}
                      className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Priority + Category */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Prioridade
                    </label>
                    <select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as Priority)}
                      className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="low">Baixa</option>
                      <option value="medium">Média</option>
                      <option value="high">Alta</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Categoria
                    </label>
                    <select
                      value={category}
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

                {/* Description */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Detalhes (Opcional)
                  </label>
                  <textarea
                    placeholder="Notas, links..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#0a0f1e] border border-slate-200 dark:border-white/5 rounded-2xl p-4 min-h-[120px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </form>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-100 dark:border-white/5 shrink-0">
              <button
                form="task-form"
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
              >
                {isEditing ? 'Salvar Alterações' : 'Adicionar Tarefa'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
