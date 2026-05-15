import React from 'react';
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ListTodo,
  Plus,
  Sparkles,
  Target,
} from 'lucide-react';
import { compareAsc, format, isPast, isToday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'motion/react';
import { MetricCard } from '../components/MetricCard';
import { TaskItem } from '../components/TaskItem';
import { getTaskTimeLabel } from '../lib/taskDueDate';
import { getDerivedTaskStatus } from '../lib/taskStatus';
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

const PRIORITY_WEIGHT: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function getTaskSortValue(task: Task): Date {
  if (!task.dueDate) return new Date(8640000000000000);

  try {
    return parseISO(task.dueDate);
  } catch {
    return new Date(8640000000000000);
  }
}

function getAssistantContext(task: Task): 'overdue' | 'today' | 'upcoming' {
  if (getDerivedTaskStatus(task) === 'overdue') return 'overdue';
  if (!task.dueDate) return 'upcoming';

  try {
    const dueDate = parseISO(task.dueDate);
    if (isPast(dueDate)) return 'overdue';
    if (isToday(dueDate)) return 'today';
  } catch {
    // keep default
  }

  return 'upcoming';
}

interface DashboardPageProps {
  tasks: Task[];
  pendingTasks: Task[];
  overdueTasks: Task[];
  completedTasks: Task[];
  todayCount: number;
  overdueCount: number;
  onViewAll: () => void;
  onOpenCompleted: () => void;
  onOpenToday: () => void;
  onOpenOverdue: () => void;
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
  overdueTasks,
  completedTasks,
  todayCount,
  overdueCount,
  onViewAll,
  onOpenCompleted,
  onOpenToday,
  onOpenOverdue,
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

  const activeTasks = React.useMemo(() => [...overdueTasks, ...pendingTasks], [overdueTasks, pendingTasks]);
  const sortedPendingTasks = [...activeTasks].sort((left, right) => {
    const dateOrder = compareAsc(getTaskSortValue(left), getTaskSortValue(right));
    if (dateOrder !== 0) return dateOrder;
    return PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
  });
  const nextTasks = sortedPendingTasks.slice(0, 5);
  const assistantTask = sortedPendingTasks[0] ?? null;
  const assistantContext = assistantTask ? getAssistantContext(assistantTask) : null;
  const assistantDueLabel = assistantTask
    ? assistantTask.dueDate
      ? format(getTaskSortValue(assistantTask), "dd 'de' MMMM", { locale: ptBR })
      : 'Sem início'
    : '';
  const assistantTimeLabel = assistantTask ? getTaskTimeLabel(assistantTask.dueDate) : null;
  const assistantPrimaryCopy = assistantContext === 'overdue'
    ? 'Seu próximo passo é recuperar este atraso.'
    : assistantContext === 'today'
      ? 'Este é o lembrete que mais merece atenção hoje.'
      : 'Este é o próximo compromisso que vale manter no radar.';
  const assistantSecondaryCopy = assistantContext === 'overdue'
    ? 'Abra o lembrete, ajuste o prazo ou conclua o que já está fora da janela ideal.'
    : assistantContext === 'today'
      ? 'Tudo indica que esse é o item com melhor retorno para avançar hoje com clareza.'
      : 'Mantendo esse lembrete sob controle, sua agenda continua leve e previsível.';
  const assistantContextAction = assistantContext === 'overdue'
    ? onOpenOverdue
    : assistantContext === 'today'
      ? onOpenToday
      : onViewAll;
  const assistantContextLabel = assistantContext === 'overdue'
    ? 'Ver atrasados'
    : assistantContext === 'today'
      ? 'Ver agenda de hoje'
      : 'Ver agenda completa';

  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6 sm:space-y-8"
    >
      <section className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <div className="surface-panel overflow-hidden p-5 sm:p-6 md:p-8">
          <div className="flex flex-col gap-5 sm:gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <span className="section-eyebrow">
                <span className="icon-slot h-4 w-4">
                  <Sparkles size={14} />
                </span>
                Visão geral do dia
              </span>
              <h3 className="mt-4 font-display text-[1.35rem] font-semibold tracking-tight text-slate-950 dark:text-white sm:mt-5 sm:text-3xl md:text-4xl">
                Clareza para decidir o que vem primeiro.
              </h3>
              <p className="mt-3 max-w-xl text-[12px] leading-6 text-slate-500 dark:text-slate-400 sm:text-sm sm:leading-7 md:text-base">
                Centralize prioridades, acompanhe prazos e mantenha uma rotina mais leve com um painel simples de consultar.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button type="button" onClick={onNewTask} className="action-primary min-h-[52px] w-full justify-center whitespace-nowrap px-5 sm:w-auto">
                <span className="icon-slot h-[18px] w-[18px]">
                  <Plus size={18} />
                </span>
                Novo lembrete
              </button>
              <button type="button" onClick={onViewAll} className="action-secondary min-h-[52px] w-full justify-center whitespace-nowrap px-5 sm:w-auto">
                <span className="icon-slot h-[18px] w-[18px]">
                  <ListTodo size={18} />
                </span>
                Ver agenda
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:mt-8 sm:gap-4 xl:grid-cols-4">
            <MetricCard
              title="Total"
              value={tasks.length}
              icon={<Target size={20} />}
              tone="brand"
              onClick={onViewAll}
              ariaLabel="Abrir todos os lembretes"
              testId="dashboard-metric-total"
            />
            <MetricCard
              title="Concluídos"
              value={completedTasks.length}
              icon={<CheckCircle2 size={20} />}
              tone="emerald"
              onClick={onOpenCompleted}
              ariaLabel="Abrir lembretes concluídos"
              testId="dashboard-metric-completed"
            />
            <MetricCard
              title="Hoje"
              value={todayCount}
              icon={<CalendarDays size={20} />}
              tone="violet"
              onClick={onOpenToday}
              ariaLabel="Abrir lembretes para hoje"
              testId="dashboard-metric-today"
            />
            <MetricCard
              title="Atrasados"
              value={overdueCount}
              icon={<Bell size={20} />}
              error
              pulse={overdueCount > 0}
              onClick={onOpenOverdue}
              ariaLabel="Abrir lembretes atrasados"
              testId="dashboard-metric-overdue"
            />
          </div>
        </div>

        <aside className="surface-panel relative flex min-h-[260px] flex-col overflow-hidden p-5 sm:p-6 md:min-h-[280px] md:p-8">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-24 rounded-full bg-blue-500/8 blur-3xl dark:bg-blue-400/10" />
          <span className="section-eyebrow w-fit">Progresso</span>
          <div className="relative mt-6 sm:mt-8">
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

          <div className="relative mt-6 sm:mt-8">
            <div className="h-3 overflow-hidden rounded-full border border-slate-200/80 bg-slate-100 shadow-[inset_0_1px_1px_rgba(255,255,255,0.7)] dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 shadow-[0_0_18px_rgba(59,130,246,0.25)] transition-all"
                style={{ width: `${completedPercentage}%` }}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="inline-flex min-h-[34px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200">
                <span
                  className={[
                    'h-2.5 w-2.5 rounded-full',
                    activeTasks.length === 0
                      ? 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]'
                      : 'bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.14)] animate-pulse',
                  ].join(' ')}
                />
                {activeTasks.length === 0
                  ? 'Tudo em dia'
                  : `${pendingTasks.length} pendente${pendingTasks.length === 1 ? '' : 's'}${
                    overdueTasks.length > 0 ? `, ${overdueTasks.length} atrasado${overdueTasks.length === 1 ? '' : 's'}` : ''
                  }`}
              </span>
              <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                {activeTasks.length === 0
                  ? 'Sua agenda está sob controle.'
                  : 'Ainda vale revisar os próximos passos.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onNewTask}
            className="group mt-auto flex min-h-[58px] w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-blue-300 hover:bg-white sm:min-h-[60px] sm:px-5 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-blue-500/40 dark:hover:bg-white/[0.06]"
          >
            <div>
              <span className="text-sm font-semibold text-slate-900 dark:text-white">
                Novo lembrete
              </span>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Registre rapidamente o próximo passo.
              </p>
            </div>
            <span className="icon-slot flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition group-hover:border-blue-300 group-hover:text-blue-600 dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-200 dark:group-hover:border-blue-500/40 dark:group-hover:text-blue-300">
              <Plus size={18} />
            </span>
          </button>
        </aside>
      </section>

      {assistantTask && (
        <section
          data-testid="assistant-focus-card"
          className="surface-panel overflow-hidden p-5 sm:p-6 md:p-7"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <span className="section-eyebrow">
                <span className="icon-slot h-4 w-4">
                  <Sparkles size={14} />
                </span>
                Assistente do dia
              </span>
              <h4 className="mt-4 text-[1.65rem] font-semibold tracking-tight text-slate-950 dark:text-white sm:text-2xl md:text-[2rem]">
                {assistantPrimaryCopy}
              </h4>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400 sm:leading-7 md:text-base">
                {assistantSecondaryCopy}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                data-testid="assistant-open-focus"
                onClick={() => onEdit(assistantTask)}
                className="action-primary min-h-[52px] justify-center whitespace-nowrap px-5"
              >
                <span className="icon-slot h-[18px] w-[18px]">
                  <Target size={18} />
                </span>
                Abrir lembrete
              </button>
              <button
                type="button"
                data-testid="assistant-open-context"
                onClick={assistantContextAction}
                className="action-secondary min-h-[52px] justify-center whitespace-nowrap px-5"
              >
                <span className="icon-slot h-[18px] w-[18px]">
                  <ArrowRight size={18} />
                </span>
                {assistantContextLabel}
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,0.55fr))]">
            <div className="col-span-2 rounded-[28px] border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.04] sm:p-5 lg:col-span-1">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    Lembrete em foco
                  </p>
                  <h5 className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
                    {assistantTask.title}
                  </h5>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    {assistantTask.description?.trim() || 'Sem detalhes extras, pronto para uma ação objetiva.'}
                  </p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
                  {assistantContext === 'overdue' ? 'Atrasado' : assistantContext === 'today' ? 'Hoje' : 'Próximo'}
                </span>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04] sm:p-5">
              <div className="icon-slot h-10 w-10 rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                <CalendarDays size={18} />
              </div>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                Prazo
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">{assistantDueLabel}</p>
            </div>

            <div className="rounded-[28px] border border-slate-200/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04] sm:p-5">
              <div className="icon-slot h-10 w-10 rounded-2xl bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                <Clock3 size={18} />
              </div>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                Horário
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">{assistantTimeLabel || 'Dia todo'}</p>
            </div>

            <div className="rounded-[28px] border border-slate-200/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04] sm:p-5">
              <div className="icon-slot h-10 w-10 rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                <Target size={18} />
              </div>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                Prioridade
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
                {assistantTask.priority === 'high'
                  ? 'Alta'
                  : assistantTask.priority === 'medium'
                    ? 'Média'
                    : 'Baixa'}
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.85fr)]">
        <div className="surface-panel p-4 sm:p-5 md:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h4 className="text-xl font-semibold text-slate-950 dark:text-white">Próximos lembretes</h4>
              <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">
                Veja o que merece sua atenção imediata.
              </p>
            </div>

            <button type="button" onClick={onViewAll} className="action-ghost self-start whitespace-nowrap sm:self-auto">
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

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <button
                      type="button"
                      data-testid="dashboard-create-first-task"
                      onClick={onNewTask}
                      className="action-primary min-h-[56px] w-full justify-center"
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
                      className="action-secondary min-h-[56px] w-full justify-center"
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
                      className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition-all hover:-translate-y-0.5 hover:bg-emerald-100 active:translate-y-0 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15"
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
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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

            {tasks.length > 0 && activeTasks.length === 0 && (
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

        <aside className="surface-panel p-4 sm:p-5 md:p-6">
          <div className="mb-4 sm:mb-5">
            <h4 className="text-xl font-semibold text-slate-950 dark:text-white">Atalhos úteis</h4>
            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 sm:text-sm">
              Crie rapidamente uma base para o restante da semana.
            </p>
          </div>

          <div className="space-y-3">
            {QUICK_START_TEMPLATES.map((template) => (
              <button
                key={template.title}
                type="button"
                onClick={() => onApplyTemplate(template)}
                className="flex w-full items-start justify-between overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50/80 px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white sm:px-4 sm:py-4 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.06]"
              >
                <div className="min-w-0 flex-1 pr-3 sm:pr-4">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{template.title}</p>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-500 dark:text-slate-400 sm:line-clamp-3 sm:text-sm sm:leading-6">
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
