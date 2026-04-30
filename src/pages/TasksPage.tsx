import React from 'react';
import {
  ArrowDownAZ,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleDot,
  Flag,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { FilterTag } from '../components/FilterTag';
import { HolidaysPanel } from '../components/HolidaysPanel';
import { TaskItem } from '../components/TaskItem';
import { LS } from '../lib/storage';
import type { HolidayCalendarPayload, Priority, Task } from '../types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 200;

type SortMode = 'created' | 'dueDate' | 'priority' | 'category';
type PriorityFilter = 'all' | Priority;
type StatusFilter = 'all' | 'pending' | 'completed';
type TasksPageView = 'agenda' | 'holidays';

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'created', label: 'Recentes' },
  { value: 'dueDate', label: 'Prazo' },
  { value: 'priority', label: 'Prioridade' },
  { value: 'category', label: 'Categoria' },
];

const PRIORITY_FILTER_OPTIONS: Array<{ value: PriorityFilter; label: string }> = [
  { value: 'all', label: 'Todas as prioridades' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Média' },
  { value: 'low', label: 'Baixa' },
];

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'completed', label: 'Concluídos' },
];

const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function isSortMode(value: unknown): value is SortMode {
  return value === 'created' || value === 'dueDate' || value === 'priority' || value === 'category';
}

function isPriorityFilter(value: unknown): value is PriorityFilter {
  return value === 'all' || value === 'high' || value === 'medium' || value === 'low';
}

function isStatusFilter(value: unknown): value is StatusFilter {
  return value === 'all' || value === 'pending' || value === 'completed';
}

interface TasksPageProps {
  pendingTasks: Task[];
  completedTasks: Task[];
  categories: string[];
  filterCategory: string;
  setFilterCategory: (category: string) => void;
  search: string;
  setSearch: (value: string) => void;
  showCompleted: boolean;
  onNewTask: () => void;
  onToggle: (task: Task) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
  onEdit: (task: Task) => void;
  deletingTaskIds?: ReadonlySet<string>;
  togglingTaskIds?: ReadonlySet<string>;
  holidayCalendar: HolidayCalendarPayload | null;
  isHolidayLoading: boolean;
  isDetectingHolidayLocation: boolean;
  onRefreshHolidays: () => void;
  onDetectHolidayLocation: () => void;
  onOpenHolidaySettings: () => void;
}

interface PaginationControlsProps {
  totalItems: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  testIdPrefix: string;
}

function parseDateValue(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}

function compareCreatedAtDesc(left: Task, right: Task): number {
  return parseDateValue(right.createdAt) - parseDateValue(left.createdAt);
}

function compareDueDateAsc(left: Task, right: Task): number {
  const dueDateDiff = parseDateValue(left.dueDate) - parseDateValue(right.dueDate);
  if (dueDateDiff !== 0) return dueDateDiff;

  const priorityDiff = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
  if (priorityDiff !== 0) return priorityDiff;

  return compareCreatedAtDesc(left, right);
}

function sortTasks(tasks: Task[], sortMode: SortMode): Task[] {
  const sortedTasks = [...tasks];

  sortedTasks.sort((left, right) => {
    if (sortMode === 'dueDate') return compareDueDateAsc(left, right);

    if (sortMode === 'priority') {
      const priorityDiff = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return compareDueDateAsc(left, right);
    }

    if (sortMode === 'category') {
      const categoryDiff = left.category.localeCompare(right.category, 'pt-BR', {
        sensitivity: 'base',
      });
      if (categoryDiff !== 0) return categoryDiff;
      return compareDueDateAsc(left, right);
    }

    return compareCreatedAtDesc(left, right);
  });

  return sortedTasks;
}

function matchesTaskFilters(
  task: Task,
  normalizedSearch: string,
  categoryFilter: string,
  priorityFilter: PriorityFilter,
): boolean {
  const haystack = [
    task.title,
    task.description,
    task.category,
    ...(task.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('pt-BR');
  const matchesSearch = haystack.includes(normalizedSearch);
  const matchesCategory = categoryFilter === 'Todas' || task.category === categoryFilter;
  const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;

  return matchesSearch && matchesCategory && matchesPriority;
}

function hasStoredCustomFilters(
  search: string,
  filterCategory: string,
  sortMode: SortMode,
  priorityFilter: PriorityFilter,
  statusFilter: StatusFilter,
) {
  return (
    search.trim().length > 0 ||
    filterCategory !== 'Todas' ||
    sortMode !== 'created' ||
    priorityFilter !== 'all' ||
    statusFilter !== 'all'
  );
}

function PaginationControls({
  totalItems,
  currentPage,
  onPageChange,
  testIdPrefix,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  if (totalItems <= PAGE_SIZE) return null;

  const startItem = (currentPage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(currentPage * PAGE_SIZE, totalItems);

  return (
    <div className="surface-soft flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p
        data-testid={`${testIdPrefix}-summary`}
        className="text-sm font-medium text-slate-500 dark:text-slate-400"
      >
        Mostrando {startItem}-{endItem} de {totalItems}
      </p>

      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <button
          type="button"
          data-testid={`${testIdPrefix}-prev`}
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="action-secondary h-10 rounded-xl px-3 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronLeft size={16} />
          Anterior
        </button>

        <span
          data-testid={`${testIdPrefix}-page`}
          className="min-w-[106px] text-center text-sm font-semibold text-slate-600 dark:text-slate-300"
        >
          Página {currentPage} de {totalPages}
        </span>

        <button
          type="button"
          data-testid={`${testIdPrefix}-next`}
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="action-secondary h-10 rounded-xl px-3 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          Próxima
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function ControlButton({
  active,
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      {...props}
      className={[
        'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all',
        active
          ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-[0_12px_24px_-18px_rgba(37,99,235,0.7)]'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function TasksPage({
  pendingTasks,
  completedTasks,
  categories,
  filterCategory,
  setFilterCategory,
  search,
  setSearch,
  showCompleted,
  onNewTask,
  onToggle,
  onDelete,
  onEdit,
  deletingTaskIds,
  togglingTaskIds,
  holidayCalendar,
  isHolidayLoading,
  isDetectingHolidayLocation,
  onRefreshHolidays,
  onDetectHolidayLocation,
  onOpenHolidaySettings,
}: TasksPageProps) {
  const config = React.useMemo(() => LS.getConfig(), []);
  const initialSortMode = isSortMode(config.taskSortMode) ? config.taskSortMode : 'created';
  const initialPriorityFilter = isPriorityFilter(config.taskPriorityFilter) ? config.taskPriorityFilter : 'all';
  const initialStatusFilter = isStatusFilter(config.taskStatusFilter) ? config.taskStatusFilter : 'all';

  const [pendingPage, setPendingPage] = React.useState(1);
  const [completedPage, setCompletedPage] = React.useState(1);
  const [sortMode, setSortMode] = React.useState<SortMode>(initialSortMode);
  const [priorityFilter, setPriorityFilter] = React.useState<PriorityFilter>(initialPriorityFilter);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>(initialStatusFilter);
  const [filtersOpen, setFiltersOpen] = React.useState(() =>
    hasStoredCustomFilters(search, filterCategory, initialSortMode, initialPriorityFilter, initialStatusFilter),
  );
  const [activeView, setActiveView] = React.useState<TasksPageView>('agenda');
  const [searchInput, setSearchInput] = React.useState(search);
  const [isMobileViewport, setIsMobileViewport] = React.useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  );

  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const handleChange = (event: MediaQueryListEvent) => setIsMobileViewport(event.matches);

    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  React.useEffect(() => {
    setSearchInput(search);
  }, [search]);

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (search !== searchInput) setSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [search, searchInput, setSearch]);

  const handleSortChange = React.useCallback((nextSortMode: SortMode) => {
    setSortMode(nextSortMode);
    const currentConfig = LS.getConfig();
    LS.saveConfig({
      ...currentConfig,
      taskSortMode: nextSortMode,
    });
  }, []);

  const handlePriorityFilterChange = React.useCallback((nextPriorityFilter: PriorityFilter) => {
    setPriorityFilter(nextPriorityFilter);
    const currentConfig = LS.getConfig();
    LS.saveConfig({
      ...currentConfig,
      taskPriorityFilter: nextPriorityFilter,
    });
  }, []);

  const handleStatusFilterChange = React.useCallback((nextStatusFilter: StatusFilter) => {
    setStatusFilter(nextStatusFilter);
    const currentConfig = LS.getConfig();
    LS.saveConfig({
      ...currentConfig,
      taskStatusFilter: nextStatusFilter,
    });
  }, []);

  const normalizedSearch = React.useMemo(
    () => search.trim().toLocaleLowerCase('pt-BR'),
    [search],
  );

  const locallyFilteredPendingTasks = React.useMemo(
    () => pendingTasks.filter((task) => matchesTaskFilters(task, normalizedSearch, filterCategory, priorityFilter)),
    [filterCategory, normalizedSearch, pendingTasks, priorityFilter],
  );

  const locallyFilteredCompletedTasks = React.useMemo(
    () => completedTasks.filter((task) => matchesTaskFilters(task, normalizedSearch, filterCategory, priorityFilter)),
    [completedTasks, filterCategory, normalizedSearch, priorityFilter],
  );

  const visiblePendingTasks = React.useMemo(
    () => (statusFilter === 'completed' ? [] : locallyFilteredPendingTasks),
    [locallyFilteredPendingTasks, statusFilter],
  );

  const visibleCompletedTasks = React.useMemo(
    () => (statusFilter === 'pending' ? [] : locallyFilteredCompletedTasks),
    [locallyFilteredCompletedTasks, statusFilter],
  );

  const sortedPendingTasks = React.useMemo(
    () => sortTasks(visiblePendingTasks, sortMode),
    [sortMode, visiblePendingTasks],
  );

  const sortedCompletedTasks = React.useMemo(
    () => sortTasks(visibleCompletedTasks, sortMode),
    [sortMode, visibleCompletedTasks],
  );

  const pendingTotalPages = Math.max(1, Math.ceil(sortedPendingTasks.length / PAGE_SIZE));
  const completedTotalPages = Math.max(1, Math.ceil(sortedCompletedTasks.length / PAGE_SIZE));

  React.useEffect(() => {
    setPendingPage(1);
  }, [filterCategory, priorityFilter, search, sortMode, statusFilter]);

  React.useEffect(() => {
    setCompletedPage(1);
  }, [filterCategory, priorityFilter, search, sortMode, statusFilter]);

  React.useEffect(() => {
    if (pendingPage > pendingTotalPages) {
      setPendingPage(pendingTotalPages);
    }
  }, [pendingPage, pendingTotalPages]);

  React.useEffect(() => {
    if (completedPage > completedTotalPages) {
      setCompletedPage(completedTotalPages);
    }
  }, [completedPage, completedTotalPages]);

  const paginatedPendingTasks = React.useMemo(() => {
    const start = (pendingPage - 1) * PAGE_SIZE;
    return sortedPendingTasks.slice(start, start + PAGE_SIZE);
  }, [pendingPage, sortedPendingTasks]);

  const paginatedCompletedTasks = React.useMemo(() => {
    const start = (completedPage - 1) * PAGE_SIZE;
    return sortedCompletedTasks.slice(start, start + PAGE_SIZE);
  }, [completedPage, sortedCompletedTasks]);

  const activeSortLabel = React.useMemo(
    () => SORT_OPTIONS.find((option) => option.value === sortMode)?.label ?? 'Recentes',
    [sortMode],
  );

  const activePriorityLabel = React.useMemo(
    () => PRIORITY_FILTER_OPTIONS.find((option) => option.value === priorityFilter)?.label ?? 'Todas as prioridades',
    [priorityFilter],
  );

  const activeStatusLabel = React.useMemo(
    () => STATUS_FILTER_OPTIONS.find((option) => option.value === statusFilter)?.label ?? 'Todos',
    [statusFilter],
  );

  const totalVisibleTasks = sortedPendingTasks.length + sortedCompletedTasks.length;
  const hasCustomFilters = hasStoredCustomFilters(
    search,
    filterCategory,
    sortMode,
    priorityFilter,
    statusFilter,
  );
  const activeFilterCount = [
    filterCategory !== 'Todas',
    sortMode !== 'created',
    priorityFilter !== 'all',
    statusFilter !== 'all',
    search.trim().length > 0,
  ].filter(Boolean).length;

  const handleResetFilters = React.useCallback(() => {
    setSearchInput('');
    setSearch('');
    setFilterCategory('Todas');
    setSortMode('created');
    setPriorityFilter('all');
    setStatusFilter('all');
    setFiltersOpen(false);

    const currentConfig = LS.getConfig();
    LS.saveConfig({
      ...currentConfig,
      taskSortMode: 'created',
      taskPriorityFilter: 'all',
      taskStatusFilter: 'all',
    });
  }, [setFilterCategory, setSearch]);

  const filtersPanel = (
    <div className="surface-soft max-w-5xl p-4 sm:p-5">
      <div className="flex flex-col gap-3 border-b border-slate-200/70 pb-4 dark:border-white/10 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Controles da lista</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Ajuste a visualização para encontrar exatamente o que precisa.
          </p>
        </div>

        <button
          type="button"
          onClick={handleResetFilters}
          disabled={!hasCustomFilters}
          className="action-ghost h-10 justify-center rounded-xl border border-transparent px-3 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-45"
        >
          <RotateCcw size={15} />
          Limpar filtros
        </button>
      </div>

      <div className="relative mt-4">
        <Search className="field-icon" size={18} />
        <input
          type="text"
          data-testid="task-search-input"
          placeholder="Buscar lembretes por título"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          className="field-control field-control-with-icon"
        />
      </div>

      <div className="mt-5 space-y-5">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="icon-slot h-8 w-8 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
              <SlidersHorizontal size={15} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Ordenação</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Escolha como os lembretes aparecem na lista.
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {SORT_OPTIONS.map((option) => {
              const isActive = sortMode === option.value;
              return (
                <ControlButton
                  key={option.value}
                  type="button"
                  data-testid={`task-sort-${option.value}`}
                  onClick={() => handleSortChange(option.value)}
                  aria-pressed={isActive}
                  active={isActive}
                >
                  {option.value === 'category' ? <ArrowDownAZ size={14} /> : <ArrowUpDown size={14} />}
                  {option.label}
                </ControlButton>
              );
            })}
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div>
            <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Prioridade</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRIORITY_FILTER_OPTIONS.map((option) => {
                const isActive = priorityFilter === option.value;
                return (
                  <ControlButton
                    key={option.value}
                    type="button"
                    data-testid={`task-priority-filter-${option.value}`}
                    onClick={() => handlePriorityFilterChange(option.value)}
                    aria-pressed={isActive}
                    active={isActive}
                    className={option.value === 'all' ? 'sm:col-span-2' : ''}
                  >
                    <Flag size={14} />
                    {option.label}
                  </ControlButton>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Status</p>
            <div className="grid gap-2">
              {STATUS_FILTER_OPTIONS.map((option) => {
                const isActive = statusFilter === option.value;
                return (
                  <ControlButton
                    key={option.value}
                    type="button"
                    data-testid={`task-status-filter-${option.value}`}
                    onClick={() => handleStatusFilterChange(option.value)}
                    aria-pressed={isActive}
                    active={isActive}
                  >
                    {option.value === 'completed' ? <CircleDot size={14} /> : <Circle size={14} />}
                    {option.label}
                  </ControlButton>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <motion.div
      key="tasks"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <section className="surface-panel p-5 md:p-6">
        <div className="space-y-5">
          <div>
            <span className="section-eyebrow">
              <ArrowUpDown size={14} />
              Organização da agenda
            </span>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Filtre, ordene e acompanhe cada entrega com clareza.
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
              Use pesquisa, categorias, prioridade e status para localizar rapidamente o que precisa ser feito agora.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveView('agenda')}
              aria-pressed={activeView === 'agenda'}
              className={[
                'inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition-all',
                activeView === 'agenda'
                  ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-[0_16px_32px_-24px_rgba(37,99,235,0.75)]'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]',
              ].join(' ')}
            >
              <ArrowUpDown size={16} />
              Agenda
            </button>

            <button
              type="button"
              onClick={() => setActiveView('holidays')}
              aria-pressed={activeView === 'holidays'}
              className={[
                'inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition-all',
                activeView === 'holidays'
                  ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-[0_16px_32px_-24px_rgba(37,99,235,0.75)]'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]',
              ].join(' ')}
            >
              <Sparkles size={16} />
              Datas e feriados
            </button>
          </div>

          {activeView === 'agenda' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                data-testid="task-filters-toggle"
                onClick={() => setFiltersOpen((current) => !current)}
                aria-expanded={filtersOpen}
                aria-controls="tasks-filters-panel"
                className="action-secondary h-11 justify-center rounded-2xl px-4 py-0 text-sm sm:justify-start"
              >
                <SlidersHorizontal size={16} />
                {filtersOpen ? 'Ocultar filtros' : activeFilterCount > 0 ? `Filtros (${activeFilterCount})` : 'Abrir filtros'}
                {filtersOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              <p className="text-sm text-slate-500 dark:text-slate-400">
                {totalVisibleTasks} lembrete{totalVisibleTasks === 1 ? '' : 's'} encontrado
                {totalVisibleTasks === 1 ? '' : 's'} com a seleção atual.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span
                data-testid="task-sort-summary"
                className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300"
              >
                Ordenado por {activeSortLabel}
              </span>
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                Categoria: {filterCategory}
              </span>
              <span
                data-testid="task-priority-summary"
                className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300"
              >
                Prioridade: {activePriorityLabel}
              </span>
              <span
                data-testid="task-status-summary"
                className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300"
              >
                Status: {activeStatusLabel}
              </span>
            </div>

            <AnimatePresence initial={false}>
              {filtersOpen && !isMobileViewport && (
                <motion.div
                  id="tasks-filters-panel"
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  {filtersPanel}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          )}
        </div>

        {activeView === 'agenda' && (
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          <FilterTag
            active={filterCategory === 'Todas'}
            onClick={() => setFilterCategory('Todas')}
            label="Todas"
          />
          {categories.map((category) => (
            <FilterTag
              key={category}
              active={filterCategory === category}
              onClick={() => setFilterCategory(category)}
              label={category}
            />
          ))}
        </div>
        )}
      </section>

      <AnimatePresence>
        {activeView === 'agenda' && filtersOpen && isMobileViewport && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFiltersOpen(false)}
              className="fixed inset-0 z-[130] bg-slate-950/45 backdrop-blur-sm lg:hidden"
            />

            <motion.section
              id="tasks-filters-panel"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="fixed inset-x-3 bottom-3 z-[131] max-h-[78vh] overflow-hidden rounded-[30px] border border-slate-200/80 bg-white/96 shadow-[0_30px_100px_-28px_rgba(15,23,42,0.5)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/96 lg:hidden"
              aria-modal="true"
              role="dialog"
              aria-labelledby="mobile-filters-title"
            >
              <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-4 dark:border-white/10">
                <div>
                  <p id="mobile-filters-title" className="text-sm font-semibold text-slate-900 dark:text-white">
                    Filtros da agenda
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {activeFilterCount} ativo{activeFilterCount === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="action-ghost h-10 rounded-xl px-3 py-0 text-sm"
                >
                  Concluir
                </button>
              </div>

              <div className="max-h-[calc(78vh-72px)] overflow-y-auto p-4">
                {filtersPanel}
              </div>
            </motion.section>
          </>
        )}
      </AnimatePresence>

      {activeView === 'holidays' && (
        <HolidaysPanel
          calendar={holidayCalendar}
          isLoading={isHolidayLoading}
          isDetectingLocation={isDetectingHolidayLocation}
          onRefresh={onRefreshHolidays}
          onDetectLocation={onDetectHolidayLocation}
          onOpenLocationSettings={onOpenHolidaySettings}
        />
      )}

      {activeView === 'agenda' && statusFilter !== 'completed' && (
        <section className="surface-panel p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h4 className="text-xl font-semibold text-slate-950 dark:text-white">Lembretes pendentes</h4>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {sortedPendingTasks.length} lembrete{sortedPendingTasks.length === 1 ? '' : 's'} em aberto
              </p>
            </div>
          </div>

          <AnimatePresence>
            {sortedPendingTasks.length > 0 ? (
              <div className="space-y-3">
                {paginatedPendingTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onToggle={onToggle}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    isDeleting={deletingTaskIds?.has(task.id)}
                    isToggling={togglingTaskIds?.has(task.id)}
                  />
                ))}

                <PaginationControls
                  totalItems={sortedPendingTasks.length}
                  currentPage={pendingPage}
                  onPageChange={setPendingPage}
                  testIdPrefix="pending-pagination"
                />
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/70 px-6 py-16 text-center dark:border-white/10 dark:bg-white/[0.03]"
              >
                <Sparkles size={34} className="mx-auto mb-4 text-slate-400" />
                <h4 className="text-lg font-semibold text-slate-900 dark:text-white">Nada por aqui</h4>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Não encontramos lembretes com os filtros atuais.
                </p>
                <button onClick={onNewTask} className="action-primary mt-6">
                  Criar lembrete
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      {activeView === 'agenda' && showCompleted && statusFilter !== 'pending' && sortedCompletedTasks.length > 0 && (
        <section className="surface-panel p-5 opacity-90 md:p-6">
          <div className="mb-5">
            <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
              Concluídos ({sortedCompletedTasks.length})
            </h4>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Histórico recente do que já foi finalizado.
            </p>
          </div>

          <div className="space-y-3">
            {paginatedCompletedTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={onToggle}
                onDelete={onDelete}
                onEdit={onEdit}
                isCompletedSection
                isDeleting={deletingTaskIds?.has(task.id)}
                isToggling={togglingTaskIds?.has(task.id)}
              />
            ))}
          </div>

          <div className="mt-4">
            <PaginationControls
              totalItems={sortedCompletedTasks.length}
              currentPage={completedPage}
              onPageChange={setCompletedPage}
              testIdPrefix="completed-pagination"
            />
          </div>
        </section>
      )}
    </motion.div>
  );
}
