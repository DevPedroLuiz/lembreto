// src/pages/TasksPage.tsx
import React from 'react';
import { Search, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { FilterTag } from '../components/FilterTag';
import { TaskItem } from '../components/TaskItem';
import { CATEGORIES } from '../types';
import type { Task } from '../types';

interface TasksPageProps {
  pendingTasks: Task[];
  completedTasks: Task[];
  filteredTasks: Task[];
  filterCategory: string;
  setFilterCategory: (cat: string) => void;
  search: string;
  setSearch: (v: string) => void;
  showCompleted: boolean;
  onNewTask: () => void;
  onToggle: (t: Task) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onEdit: (t: Task) => void;
}

export function TasksPage({
  filteredTasks,
  completedTasks,
  filterCategory,
  setFilterCategory,
  search,
  setSearch,
  showCompleted,
  onNewTask,
  onToggle,
  onDelete,
  onEdit,
}: TasksPageProps) {
  return (
    <motion.div
      key="tasks"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      {/* Busca + filtros mobile */}
      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            placeholder="Buscar tarefas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="md:hidden flex overflow-x-auto gap-2 pb-1">
          <FilterTag active={filterCategory === 'Todas'} onClick={() => setFilterCategory('Todas')} label="Todas" />
          {CATEGORIES.map((cat) => (
            <FilterTag key={cat} active={filterCategory === cat} onClick={() => setFilterCategory(cat)} label={cat} />
          ))}
        </div>
      </div>

      {/* Lista de tarefas */}
      <div className="space-y-4">
        <AnimatePresence>
          {filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={onToggle}
                onDelete={onDelete}
                onEdit={onEdit}
              />
            ))
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-20 bg-white/30 dark:bg-white/5 border border-dashed border-slate-200 dark:border-white/10 rounded-3xl"
            >
              <Sparkles size={32} className="mx-auto mb-4 text-slate-400" />
              <h3 className="text-lg font-semibold mb-2">Nada por aqui</h3>
              <p className="text-slate-500 mb-6">Nenhuma tarefa encontrada.</p>
              <button
                onClick={onNewTask}
                className="px-6 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-semibold active:scale-95 transition-transform"
              >
                Criar Tarefa
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Concluídas */}
      {showCompleted && filterCategory === 'Todas' && !search && completedTasks.length > 0 && (
        <div className="mt-12 opacity-60">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-4">
            Concluídas ({completedTasks.length})
          </h3>
          <div className="space-y-3">
            {completedTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={onToggle}
                onDelete={onDelete}
                onEdit={onEdit}
                isCompletedSection
              />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
