// src/pages/DashboardPage.tsx
import React from 'react';
import { CheckCircle2, Target, CalendarDays, Bell, ArrowRight, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { MetricCard } from '../components/MetricCard';
import { TaskItem } from '../components/TaskItem';
import type { Task } from '../types';

interface DashboardPageProps {
  tasks: Task[];
  pendingTasks: Task[];
  completedTasks: Task[];
  todayCount: number;
  overdueCount: number;
  onViewAll: () => void;
  onNewTask: () => void;
  onToggle: (t: Task) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onEdit: (t: Task) => void;
}

export function DashboardPage({
  tasks,
  pendingTasks,
  completedTasks,
  todayCount,
  overdueCount,
  onViewAll,
  onNewTask,
  onToggle,
  onDelete,
  onEdit,
}: DashboardPageProps) {
  return (
    <motion.div
      key="dash"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-10"
    >
      {/* Métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <MetricCard title="Total"    value={tasks.length}          icon={<Target size={20} />} />
        <MetricCard title="Feitas"   value={completedTasks.length} icon={<CheckCircle2 size={20} />} />
        <MetricCard title="Hoje"     value={todayCount}            icon={<CalendarDays size={20} />} />
        <MetricCard title="Atrasadas" value={overdueCount}         icon={<Bell size={20} />} error />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Pendentes */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Pendentes</h3>
            <button
              onClick={onViewAll}
              className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              Ver todas <ArrowRight size={16} />
            </button>
          </div>
          <div className="bg-white/50 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 rounded-[2rem] p-4 space-y-3">
            {pendingTasks.slice(0, 5).map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={onToggle}
                onDelete={onDelete}
                onEdit={onEdit}
                compact
              />
            ))}
            {pendingTasks.length === 0 && (
              <div className="py-16 text-center opacity-60">
                <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-500" />
                <p className="font-medium">Nenhuma pendência.</p>
              </div>
            )}
          </div>
        </div>

        {/* Progresso */}
        <div className="bg-slate-900 dark:bg-[#131b2f] rounded-[2rem] p-8 text-white relative overflow-hidden flex flex-col min-h-[280px]">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <Sparkles size={100} />
          </div>
          <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-widest border border-white/10 w-fit">
            Progresso
          </span>
          <div className="mt-auto z-10">
            <h3 className="text-5xl font-light mt-8 mb-2">
              {completedTasks.length}{' '}
              <span className="text-slate-400 text-2xl">/ {tasks.length}</span>
            </h3>
            <p className="text-slate-400 text-sm mb-6">Tarefas completadas.</p>
            <button
              onClick={onNewTask}
              className="w-full bg-white text-slate-900 font-bold py-4 rounded-2xl hover:bg-slate-100 transition-all active:scale-95"
            >
              Nova Meta
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
