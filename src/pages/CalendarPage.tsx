import React from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Flag,
  Hash,
  ListFilter,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { format, isToday, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { TaskItem } from '../components/TaskItem';
import { cn } from '../lib/cn';
import { getTaskTimeLabel } from '../lib/taskDueDate';
import { getDerivedTaskStatus, type DerivedTaskStatus } from '../lib/taskStatus';
import type { Priority, Task } from '../types';

type StatusFilter = 'all' | DerivedTaskStatus;
type PriorityFilter = 'all' | Priority;
type CalendarPanel = 'calendar' | 'filters';

interface CalendarPageProps {
  tasks: Task[];
  categories: string[];
  tags: string[];
  onNewTask: () => void;
  onToggle: (task: Task) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
  onEdit: (task: Task) => void;
  deletingTaskIds?: ReadonlySet<string>;
  togglingTaskIds?: ReadonlySet<string>;
}

const WEEKDAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];

const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};

const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  high: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300',
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'overdue', label: 'Atrasados' },
  { value: 'completed', label: 'Concluídos' },
  { value: 'cancelled', label: 'Cancelados' },
];

const PRIORITY_OPTIONS: Array<{ value: PriorityFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Média' },
  { value: 'low', label: 'Baixa' },
];

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseTaskDate(task: Task): Date | null {
  if (!task.dueDate) return null;

  try {
    const date = parseISO(task.dueDate);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function addCalendarDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function startOfWeek(date: Date): Date {
  const weekStart = new Date(date);
  const weekday = weekStart.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  weekStart.setDate(weekStart.getDate() + diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function buildCalendarDays(cursorDate: Date): Date[] {
  const firstDay = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
  const calendarStart = startOfWeek(firstDay);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(calendarStart, index));
}

function formatMonthLabel(date: Date): string {
  return format(date, 'MMMM yyyy', { locale: ptBR });
}

function formatSelectedDateLabel(date: Date): string {
  return format(date, "EEEE, dd 'de' MMMM", { locale: ptBR });
}

function buildAvailableTags(tags: string[], tasks: Task[]): string[] {
  const tagUsage = new Map<string, { label: string; count: number }>();

  const normalizeTagKey = (value: string) => value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

  const append = (value: string, count = 0) => {
    const normalized = value.trim();
    if (!normalized) return;

    const key = normalizeTagKey(normalized);
    const current = tagUsage.get(key);

    if (current) {
      current.count += count;
      return;
    }

    tagUsage.set(key, { label: normalized, count });
  };

  tags.forEach((tag) => append(tag));
  tasks.forEach((task) => (task.tags ?? []).forEach((tag) => append(tag, 1)));

  return Array.from(tagUsage.values())
    .sort((left, right) => (
      right.count - left.count ||
      left.label.localeCompare(right.label, 'pt-BR', { sensitivity: 'base' })
    ))
    .map((item) => item.label);
}

function compareTasksByDueDate(left: Task, right: Task): number {
  const leftDate = parseTaskDate(left)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightDate = parseTaskDate(right)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return leftDate - rightDate;
}

function matchesFilters(
  task: Task,
  search: string,
  statusFilter: StatusFilter,
  priorityFilter: PriorityFilter,
  categoryFilter: string,
  tagFilter: string,
): boolean {
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
  const haystack = [
    task.title,
    task.description,
    task.category,
    ...(task.tags ?? []),
  ]
    .join(' ')
    .toLocaleLowerCase('pt-BR');

  const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
  const matchesStatus = statusFilter === 'all' || getDerivedTaskStatus(task) === statusFilter;
  const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
  const matchesCategory = categoryFilter === 'Todas' || task.category === categoryFilter;
  const matchesTag = tagFilter === 'Todas' || (task.tags ?? []).includes(tagFilter);

  return matchesSearch && matchesStatus && matchesPriority && matchesCategory && matchesTag;
}

function getWeekRange(date: Date) {
  const start = startOfWeek(date);
  const end = addCalendarDays(start, 6);
  return { start: formatDateKey(start), end: formatDateKey(end) };
}

function FilterButton({
  active,
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all',
        active
          ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-[0_14px_28px_-22px_rgba(37,99,235,0.72)]'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]',
        className,
      )}
    >
      {children}
    </button>
  );
}

function EmptyDayState({ onNewTask }: { onNewTask: () => void }) {
  return (
    <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center dark:border-white/10 dark:bg-white/[0.03]">
      <Sparkles size={28} className="mx-auto mb-3 text-slate-400" />
      <h4 className="text-base font-semibold text-slate-900 dark:text-white">Nenhum lembrete neste dia</h4>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
        Crie um lembrete para preencher este espaço do calendário.
      </p>
      <button type="button" onClick={onNewTask} className="action-primary mt-5">
        <Plus size={18} />
        Novo lembrete
      </button>
    </div>
  );
}

export function CalendarPage({
  tasks,
  categories,
  tags,
  onNewTask,
  onToggle,
  onDelete,
  onEdit,
  deletingTaskIds,
  togglingTaskIds,
}: CalendarPageProps) {
  const today = React.useMemo(() => new Date(), []);
  const [cursorDate, setCursorDate] = React.useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = React.useState(today);
  const [activePanel, setActivePanel] = React.useState<CalendarPanel>('calendar');
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = React.useState<PriorityFilter>('all');
  const [categoryFilter, setCategoryFilter] = React.useState('Todas');
  const [tagFilter, setTagFilter] = React.useState('Todas');

  const availableTags = React.useMemo(() => buildAvailableTags(tags, tasks), [tags, tasks]);
  const calendarDays = React.useMemo(() => buildCalendarDays(cursorDate), [cursorDate]);

  const filteredTasks = React.useMemo(
    () =>
      tasks
        .filter((task) => matchesFilters(task, search, statusFilter, priorityFilter, categoryFilter, tagFilter))
        .sort(compareTasksByDueDate),
    [categoryFilter, priorityFilter, search, statusFilter, tagFilter, tasks],
  );

  const tasksByDay = React.useMemo(() => {
    const grouped = new Map<string, Task[]>();

    filteredTasks.forEach((task) => {
      const dueDate = parseTaskDate(task);
      if (!dueDate) return;

      const key = formatDateKey(dueDate);
      const current = grouped.get(key) ?? [];
      current.push(task);
      grouped.set(key, current);
    });

    grouped.forEach((dayTasks, key) => {
      grouped.set(key, [...dayTasks].sort(compareTasksByDueDate));
    });

    return grouped;
  }, [filteredTasks]);

  const selectedDateKey = formatDateKey(selectedDate);
  const selectedTasks = tasksByDay.get(selectedDateKey) ?? [];
  const selectedPendingCount = selectedTasks.filter((task) => getDerivedTaskStatus(task) === 'pending').length;
  const selectedOverdueCount = selectedTasks.filter((task) => getDerivedTaskStatus(task) === 'overdue').length;
  const selectedCompletedCount = selectedTasks.filter((task) => getDerivedTaskStatus(task) === 'completed').length;
  const monthPrefix = `${cursorDate.getFullYear()}-${`${cursorDate.getMonth() + 1}`.padStart(2, '0')}`;
  const monthTaskCount = filteredTasks.filter((task) => {
    const dueDate = parseTaskDate(task);
    return dueDate ? formatDateKey(dueDate).startsWith(monthPrefix) : false;
  }).length;
  const weekRange = getWeekRange(selectedDate);
  const selectedWeekCount = filteredTasks.filter((task) => {
    const dueDate = parseTaskDate(task);
    if (!dueDate) return false;
    const key = formatDateKey(dueDate);
    return key >= weekRange.start && key <= weekRange.end;
  }).length;
  const overdueCount = filteredTasks.filter((task) => getDerivedTaskStatus(task) === 'overdue').length;
  const activeFilterCount = [
    search.trim(),
    statusFilter !== 'all',
    priorityFilter !== 'all',
    categoryFilter !== 'Todas',
    tagFilter !== 'Todas',
  ].filter(Boolean).length;

  const goToPreviousMonth = () => {
    setCursorDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCursorDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  };

  const goToToday = () => {
    const nextToday = new Date();
    setCursorDate(new Date(nextToday.getFullYear(), nextToday.getMonth(), 1));
    setSelectedDate(nextToday);
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setCategoryFilter('Todas');
    setTagFilter('Todas');
  };

  const filtersPanel = (
    <section className="surface-panel p-4 md:p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <span className="section-eyebrow">
            <SlidersHorizontal size={14} />
            Filtros
          </span>
          <h3 className="mt-4 text-xl font-semibold text-slate-950 dark:text-white">Refinar calendário</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Ajuste a visualização sem sair da página.
          </p>
        </div>

        {activeFilterCount > 0 && (
          <button type="button" onClick={clearFilters} className="action-ghost h-10 rounded-xl px-3 py-0 text-sm">
            Limpar
          </button>
        )}
      </div>

      <div className="space-y-5">
        <div>
          <label htmlFor="calendar-search" className="mb-2 block text-sm font-semibold text-slate-900 dark:text-white">
            Buscar lembrete
          </label>
          <div className="relative">
            <Search size={16} className="field-icon" />
            <input
              id="calendar-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="field-control field-control-with-icon"
              placeholder="Título, categoria ou tag"
            />
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Status</p>
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
            {STATUS_OPTIONS.map((option) => (
              <FilterButton
                key={option.value}
                type="button"
                active={statusFilter === option.value}
                onClick={() => setStatusFilter(option.value)}
                aria-pressed={statusFilter === option.value}
              >
                {option.value === 'completed' ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                {option.label}
              </FilterButton>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Prioridade</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PRIORITY_OPTIONS.map((option) => (
              <FilterButton
                key={option.value}
                type="button"
                active={priorityFilter === option.value}
                onClick={() => setPriorityFilter(option.value)}
                aria-pressed={priorityFilter === option.value}
              >
                <Flag size={14} />
                {option.label}
              </FilterButton>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Categorias</p>
          <div className="flex flex-wrap gap-2">
            <FilterButton
              type="button"
              active={categoryFilter === 'Todas'}
              onClick={() => setCategoryFilter('Todas')}
              aria-pressed={categoryFilter === 'Todas'}
            >
              <Hash size={14} />
              Todas
            </FilterButton>
            {categories.map((category) => (
              <FilterButton
                key={category}
                type="button"
                active={categoryFilter === category}
                onClick={() => setCategoryFilter(category)}
                aria-pressed={categoryFilter === category}
              >
                <Hash size={14} />
                {category}
              </FilterButton>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Tags</p>
          <div className="flex flex-wrap gap-2">
            <FilterButton
              type="button"
              active={tagFilter === 'Todas'}
              onClick={() => setTagFilter('Todas')}
              aria-pressed={tagFilter === 'Todas'}
            >
              <Tag size={14} />
              Todas
            </FilterButton>
            {availableTags.map((tag) => (
              <FilterButton
                key={tag}
                type="button"
                active={tagFilter === tag}
                onClick={() => setTagFilter(tag)}
                aria-pressed={tagFilter === tag}
              >
                <Tag size={14} />
                {tag}
              </FilterButton>
            ))}
          </div>

          {availableTags.length === 0 && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Nenhuma tag foi usada ainda.
            </p>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <motion.div
      key="calendar"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <section className="surface-panel p-5 md:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <span className="section-eyebrow">
              <CalendarDays size={14} />
              Dashboard semanal
            </span>
            <h3 className="mt-4 text-2xl font-semibold text-slate-950 dark:text-white md:text-3xl">
              Calendário de lembretes
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
              Veja cada lembrete posicionado no dia certo e acompanhe a semana com leitura rápida.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[520px]">
            <div className="surface-soft px-4 py-3">
              <p className="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Mês</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{monthTaskCount}</p>
            </div>
            <div className="surface-soft px-4 py-3">
              <p className="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Semana</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{selectedWeekCount}</p>
            </div>
            <div className="surface-soft px-4 py-3">
              <p className="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">Atrasados</p>
              <p className="mt-1 text-2xl font-semibold text-rose-600 dark:text-rose-300">{overdueCount}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="inline-grid grid-cols-2 rounded-2xl bg-slate-100 p-1 dark:bg-white/[0.05] md:w-auto">
            <button
              type="button"
              onClick={() => setActivePanel('calendar')}
              aria-pressed={activePanel === 'calendar'}
              className={cn(
                'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all',
                activePanel === 'calendar'
                  ? 'bg-white text-slate-950 shadow-[0_12px_24px_-18px_rgba(15,23,42,0.45)] dark:bg-white/[0.12] dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
              )}
            >
              <CalendarDays size={16} />
              Calendário
            </button>
            <button
              type="button"
              onClick={() => setActivePanel('filters')}
              aria-pressed={activePanel === 'filters'}
              className={cn(
                'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all',
                activePanel === 'filters'
                  ? 'bg-white text-slate-950 shadow-[0_12px_24px_-18px_rgba(15,23,42,0.45)] dark:bg-white/[0.12] dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
              )}
            >
              <ListFilter size={16} />
              Filtros
              {activeFilterCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          <button type="button" onClick={onNewTask} className="action-primary">
            <Plus size={18} />
            Novo lembrete
          </button>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="surface-panel overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-slate-200/70 p-4 dark:border-white/10 md:flex-row md:items-center md:justify-between md:p-5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goToPreviousMonth}
                  aria-label="Mês anterior"
                  className="action-secondary h-11 w-11 rounded-xl p-0"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  onClick={goToNextMonth}
                  aria-label="Próximo mês"
                  className="action-secondary h-11 w-11 rounded-xl p-0"
                >
                  <ChevronRight size={18} />
                </button>
                <button type="button" onClick={goToToday} className="action-ghost h-11 rounded-xl px-3 py-0 text-sm">
                  Hoje
                </button>
              </div>

              <div className="min-w-0">
                <h3 className="text-xl font-semibold capitalize text-slate-950 dark:text-white md:text-2xl">
                  {formatMonthLabel(cursorDate)}
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {filteredTasks.length} lembrete{filteredTasks.length === 1 ? '' : 's'} com os filtros atuais
                </p>
              </div>
            </div>

            <div className="grid grid-cols-7 border-b border-slate-200/70 bg-slate-50/75 dark:border-white/10 dark:bg-white/[0.03]">
              {WEEKDAY_LABELS.map((weekday) => (
                <div
                  key={weekday}
                  className="px-1 py-3 text-center text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400 sm:text-xs"
                >
                  {weekday}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {calendarDays.map((day) => {
                const dayKey = formatDateKey(day);
                const dayTasks = tasksByDay.get(dayKey) ?? [];
                const isCurrentMonth = day.getMonth() === cursorDate.getMonth();
                const isSelected = dayKey === selectedDateKey;
                const hasOverdue = dayTasks.some((task) => getDerivedTaskStatus(task) === 'overdue');

                return (
                  <div
                    key={dayKey}
                    role="button"
                    tabIndex={0}
                    aria-label={`${format(day, "dd 'de' MMMM", { locale: ptBR })}, ${dayTasks.length} lembretes`}
                    onClick={() => setSelectedDate(day)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setSelectedDate(day);
                    }}
                    className={cn(
                      'group min-h-[94px] cursor-pointer border-b border-r border-slate-200/70 p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:border-white/10 sm:min-h-[122px] sm:p-2.5',
                      isCurrentMonth
                        ? 'bg-white/70 hover:bg-blue-50/70 dark:bg-slate-950/38 dark:hover:bg-blue-500/10'
                        : 'bg-slate-50/60 text-slate-400 dark:bg-white/[0.02] dark:text-slate-600',
                      isSelected && 'bg-blue-50 ring-2 ring-inset ring-blue-500/45 dark:bg-blue-500/12',
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          'inline-flex h-7 min-w-7 items-center justify-center rounded-xl px-1 text-xs font-bold sm:h-8 sm:min-w-8 sm:text-sm',
                          isToday(day)
                            ? 'bg-blue-600 text-white shadow-[0_12px_24px_-18px_rgba(37,99,235,0.8)]'
                            : isSelected
                              ? 'bg-white text-blue-700 dark:bg-white/12 dark:text-blue-200'
                              : 'text-slate-700 dark:text-slate-300',
                        )}
                      >
                        {format(day, 'd')}
                      </span>

                      {dayTasks.length > 0 && (
                        <span
                          className={cn(
                            'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                            hasOverdue
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200'
                              : 'bg-slate-100 text-slate-600 dark:bg-white/[0.07] dark:text-slate-300',
                          )}
                        >
                          {dayTasks.length}
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 space-y-1 sm:mt-2">
                      {dayTasks.slice(0, 3).map((task) => {
                        const timeLabel = getTaskTimeLabel(task.dueDate);
                        return (
                          <button
                            key={task.id}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onEdit(task);
                            }}
                            className={cn(
                              'block w-full truncate rounded-lg border px-1.5 py-1 text-left text-[10px] font-semibold transition-transform hover:-translate-y-0.5 sm:text-[11px]',
                              getDerivedTaskStatus(task) === 'completed'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 line-through dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                                : getDerivedTaskStatus(task) === 'overdue'
                                  ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
                                : PRIORITY_STYLES[task.priority],
                            )}
                            title={task.title}
                          >
                            {timeLabel ? `${timeLabel} ` : ''}
                            {task.title}
                          </button>
                        );
                      })}

                      {dayTasks.length > 3 && (
                        <span className="block rounded-lg bg-slate-100 px-1.5 py-1 text-[10px] font-semibold text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                          +{dayTasks.length - 3} mais
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="surface-panel p-5 md:p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <span className="section-eyebrow">
                  <Clock3 size={14} />
                  Dia selecionado
                </span>
                <h3 className="mt-4 text-xl font-semibold capitalize text-slate-950 dark:text-white">
                  {formatSelectedDateLabel(selectedDate)}
                </h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  {selectedPendingCount} pendente{selectedPendingCount === 1 ? '' : 's'}, {selectedOverdueCount} atrasado
                  {selectedOverdueCount === 1 ? '' : 's'} e {selectedCompletedCount} concluído
                  {selectedCompletedCount === 1 ? '' : 's'}.
                </p>
              </div>

              <button type="button" onClick={onNewTask} className="action-secondary h-11 rounded-xl px-4 py-0 text-sm">
                <Plus size={16} />
                Adicionar
              </button>
            </div>

            <AnimatePresence mode="popLayout">
              {selectedTasks.length > 0 ? (
                <div className="space-y-3">
                  {selectedTasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onToggle={onToggle}
                      onDelete={onDelete}
                      onEdit={onEdit}
                      showToggleControl
                      compact
                      isDeleting={deletingTaskIds?.has(task.id)}
                      isToggling={togglingTaskIds?.has(task.id)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyDayState onNewTask={onNewTask} />
              )}
            </AnimatePresence>
          </section>
        </div>

        <div className={cn(
          activePanel === 'filters' ? 'order-first block xl:order-none' : 'hidden xl:block',
        )}>
          {filtersPanel}
        </div>
      </div>
    </motion.div>
  );
}
