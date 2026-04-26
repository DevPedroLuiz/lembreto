import React from 'react';
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ListTodo,
  Plus,
  Sparkles,
  Target,
} from 'lucide-react';
import { motion } from 'motion/react';
import { MetricCard } from '../components/MetricCard';
import { TaskItem } from '../components/TaskItem';
import type { Priority, Task } from '../types';

export interface QuickStartTemplate {
  title: string;
  description: string;
  category: string;
  priority: Priority;
  date: string;
  time?: string;
}

function formatFutureDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const QUICK_START_TEMPLATES: QuickStartTemplate[] = [
  {
    title: 'Planejar a semana',
    description: 'Liste as 3 prioridades que precisam sair do papel nos próximos dias.',
    category: 'Trabalho',
    priority: 'high',
    date: formatFutureDate(1),
    time: '09:00',
  },
  {
    title: 'Organizar a rotina pessoal',
    description: 'Defina um lembrete simples para destravar a casa, as contas ou os compromissos.',
    category: 'Pessoal',
    priority: 'medium',
    date: formatFutureDate(2),
  },
  {
    title: 'Sessão de estudos',
    description: 'Crie um bloco focado para revisar um tema importante com tranquilidade.',
    category: 'Estudos',
    priority: 'medium',
    date: formatFutureDate(3),
    time: '19:00',
  },
];

interface DashboardPageProps {
  tasks: Task[];
  pendingTasks: Task[];
  completedTasks: Task[];
  todayCount: number;
  overdueCount: number;
  onViewAll: () => void;
  onNewTask: () => void;
  onApplyTemplate: (template: QuickStartTemplate) => void;
  onToggle: (task: Task) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
  onEdit: (task: Task) => void;
  deletingTaskIds?: ReadonlySet<string>;
  togglingTaskIds?: ReadonlySet<string>;
}

export function DashboardPage({
  tasks,
  pendingTasks,
  completedTasks,
  todayCount,
  overdueCount,
  onViewAll,
  onNewTask,
  onApplyTemplate,
  onToggle,
  onDelete,
  onEdit,
  deletingTaskIds,
  togglingTaskIds,
}: DashboardPageProps) {
  const completedPercentage = tasks.length === 0
    ? 0
    : Math.round((completedTasks.length / tasks.length) * 100);

  const nextTasks = pendingTasks.slice(0, 5);

  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8"
    >
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <div className="surface-panel overflow-hidden p-6 md:p-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <span className="section-eyebrow">
                <span className="icon-slot h-4 w-4">
                  <Sparkles size={14} />
                </span>
                Visão geral do dia
              </span>
              <h3 className="mt-5 font-display text-3xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-4xl">
                Clareza para decidir o que vem primeiro.
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-7 text-slate-500 dark:text-slate-400 md:text-base">
                Centralize prioridades, acompanhe prazos e mantenha uma rotina mais leve com um painel simples de consultar.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={onNewTask} className="action-primary min-h-[52px] whitespace-nowrap px-5">
                <span className="icon-slot h-[18px] w-[18px]">
                  <Plus size={18} />
                </span>
                Novo lembrete
              </button>
              <button type="button" onClick={onViewAll} className="action-secondary min-h-[52px] whitespace-nowrap px-5">
                <span className="icon-slot h-[18px] w-[18px]">
                  <ListTodo size={18} />
                </span>
                Ver agenda
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-4">
            <MetricCard title="Total" value={tasks.length} icon={<Target size={20} />} tone="brand" />
            <MetricCard title="Concluídos" value={completedTasks.length} icon={<CheckCircle2 size={20} />} tone="emerald" />
            <MetricCard title="Para hoje" value={todayCount} icon={<CalendarDays size={20} />} tone="violet" />
            <MetricCard title="Atrasados" value={overdueCount} icon={<Bell size={20} />} error />
          </div>
        </div>

        <aside className="surface-panel flex min-h-[280px] flex-col overflow-hidden p-6 md:p-8">
          <span className="section-eyebrow w-fit">Progresso</span>
          <div className="mt-8">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Desempenho da sua lista</p>
            <div className="mt-3 flex items-end gap-2">
              <span className="font-display text-5xl font-semibold tracking-tight text-slate-950 dark:text-white">
                {completedPercentage}%
              </span>
              <span className="pb-2 text-sm text-slate-500 dark:text-slate-400">
                concluído
              </span>
            </div>
          </div>

          <div className="mt-8">
            <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 to-sky-500 transition-all"
                style={{ width: `${completedPercentage}%` }}
              />
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {pendingTasks.length === 0
                ? 'Sua lista está limpa no momento. Aproveite para planejar os próximos passos.'
                : `${pendingTasks.length} lembrete${pendingTasks.length === 1 ? '' : 's'} ainda requer atenção.`}
            </p>
          </div>

          <button type="button" onClick={onNewTask} className="action-secondary mt-auto w-full">
            <span className="icon-slot h-[18px] w-[18px]">
              <Plus size={18} />
            </span>
            Registrar nova meta
          </button>
        </aside>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.85fr)]">
        <div className="surface-panel p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h4 className="text-xl font-semibold text-slate-950 dark:text-white">Próximos lembretes</h4>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Veja o que merece sua atenção imediata.
              </p>
            </div>

            <button type="button" onClick={onViewAll} className="action-ghost">
              Ver tudo
              <span className="icon-slot h-4 w-4">
                <ArrowRight size={16} />
              </span>
            </button>
          </div>

          <div className="space-y-3">
            {tasks.length === 0 && (
              <div
                data-testid="dashboard-welcome-state"
                className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 p-6 dark:border-white/10 dark:bg-white/[0.03] md:p-7"
              >
                <div className="flex flex-col gap-6">
                  <div className="max-w-2xl">
                    <span className="section-eyebrow">
                      <span className="icon-slot h-4 w-4">
                        <Sparkles size={14} />
                      </span>
                      Primeiro acesso
                    </span>
                    <h4 className="mt-4 text-2xl font-semibold text-slate-950 dark:text-white">
                      Vamos preparar seu espaço de trabalho
                    </h4>
                    <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
                      Você ainda não criou nenhum lembrete. Comece pelo essencial ou use um exemplo pronto para sentir o fluxo do aplicativo.
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <button
                      type="button"
                      data-testid="dashboard-create-first-task"
                      onClick={onNewTask}
                      className="action-primary min-h-[56px]"
                    >
                      <span className="icon-slot h-[18px] w-[18px]">
                        <Plus size={18} />
                      </span>
                      Criar primeiro lembrete
                    </button>
                    <button
                      type="button"
                      data-testid="dashboard-explore-categories"
                      onClick={onViewAll}
                      className="action-secondary min-h-[56px]"
                    >
                      <span className="icon-slot h-[18px] w-[18px]">
                        <ListTodo size={18} />
                      </span>
                      Explorar categorias
                    </button>
                    <button
                      type="button"
                      data-testid="dashboard-use-example"
                      onClick={() => onApplyTemplate(QUICK_START_TEMPLATES[0])}
                      className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition-all hover:-translate-y-0.5 hover:bg-emerald-100 active:translate-y-0 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15"
                    >
                      <span className="icon-slot h-[18px] w-[18px]">
                        <Sparkles size={18} />
                      </span>
                      Usar um exemplo
                    </button>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Sugestões rápidas
                    </p>
                    <div className="grid gap-3 md:grid-cols-3">
                      {QUICK_START_TEMPLATES.map((template) => (
                        <button
                          key={template.title}
                          type="button"
                          data-testid={`dashboard-template-${template.category.toLowerCase()}`}
                          onClick={() => onApplyTemplate(template)}
                          className="rounded-[24px] border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.06]"
                        >
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">
                              {template.title}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:bg-white/[0.06] dark:text-slate-300">
                              {template.category}
                            </span>
                          </div>
                          <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                            {template.description}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tasks.length > 0 && nextTasks.map((task) => (
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

            {tasks.length > 0 && pendingTasks.length === 0 && (
              <div className="rounded-[28px] border border-dashed border-emerald-200 bg-emerald-50/70 px-6 py-14 text-center dark:border-emerald-500/20 dark:bg-emerald-500/10">
                <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-500" />
                <p className="text-lg font-semibold text-slate-900 dark:text-white">Nenhuma pendência no momento.</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Sua lista está em dia. Registre um novo lembrete quando quiser.
                </p>
              </div>
            )}
          </div>
        </div>

        <aside className="surface-panel p-5 md:p-6">
          <div className="mb-5">
            <h4 className="text-xl font-semibold text-slate-950 dark:text-white">Atalhos úteis</h4>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Crie rapidamente uma base para o restante da semana.
            </p>
          </div>

          <div className="space-y-3">
            {QUICK_START_TEMPLATES.map((template) => (
              <button
                key={template.title}
                type="button"
                onClick={() => onApplyTemplate(template)}
                className="flex w-full items-start justify-between rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.06]"
              >
                <div className="pr-4">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{template.title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    {template.description}
                  </p>
                </div>
                <span className="icon-slot mt-1 h-4 w-4 shrink-0 text-slate-400">
                  <ArrowRight size={16} />
                </span>
              </button>
            ))}
          </div>
        </aside>
      </section>
    </motion.div>
  );
}
