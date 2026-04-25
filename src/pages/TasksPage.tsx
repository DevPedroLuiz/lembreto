import React from 'react';
import {
  ArrowDownAZ,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Sparkles,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { FilterTag } from '../components/FilterTag';
import { TaskItem } from '../components/TaskItem';
import { LS } from '../lib/storage';
import { CATEGORIES } from '../types';
import type { Priority, Task } from '../types';

const PAGE_SIZE = 20;

type SortMode = 'created' | 'dueDate' | 'priority' | 'category';

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'created', label: 'Recentes' },
  { value: 'dueDate', label: 'Prazo' },
  { value: 'priority', label: 'Prioridade' },
  { value: 'category', label: 'Categoria' },
];

const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function isSortMode(value: unknown): value is SortMode {
  return value === 'created' || value === 'dueDate' || value === 'priority' || value === 'category';
}

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
  deletingTaskIds?: ReadonlySet<string>;
  togglingTaskIds?: ReadonlySet<string>;
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
    if (sortMode === 'dueDate') {
      return compareDueDateAsc(left, right);
    }

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
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between">
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
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <ChevronLeft size={16} />
          Anterior
        </button>
        <span
          data-testid={`${testIdPrefix}-page`}
          className="min-w-[84px] text-center text-sm font-semibold text-slate-600 dark:text-slate-300"
        >
          Pagina {currentPage} de {totalPages}
        </span>
        <button
          type="button"
          data-testid={`${testIdPrefix}-next`}
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
        >
          Proxima
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
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
  deletingTaskIds,
  togglingTaskIds,
}: TasksPageProps) {
  const [pendingPage, setPendingPage] = React.useState(1);
  const [completedPage, setCompletedPage] = React.useState(1);
  const [sortMode, setSortMode] = React.useState<SortMode>(() => {
    const config = LS.getConfig();
    return isSortMode(config.taskSortMode) ? config.taskSortMode : 'created';
  });

  const handleSortChange = React.useCallback((nextSortMode: SortMode) => {
    setSortMode(nextSortMode);
    const config = LS.getConfig();
    LS.saveConfig({
      ...config,
      taskSortMode: nextSortMode,
    });
  }, []);

  const sortedPendingTasks = React.useMemo(
    () => sortTasks(filteredTasks, sortMode),
    [filteredTasks, sortMode]
  );

  const sortedCompletedTasks = React.useMemo(
    () => sortTasks(completedTasks, sortMode),
    [completedTasks, sortMode]
  );

  const pendingTotalPages = Math.max(1, Math.ceil(sortedPendingTasks.length / PAGE_SIZE));
  const completedTotalPages = Math.max(1, Math.ceil(sortedCompletedTasks.length / PAGE_SIZE));

  React.useEffect(() => {
    setPendingPage(1);
  }, [filterCategory, search, sortMode]);

  React.useEffect(() => {
    setCompletedPage(1);
  }, [sortMode]);

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

  const activeSortLabel = React.useMemo(() => {
    return SORT_OPTIONS.find((option) => option.value === sortMode)?.label ?? 'Recentes';
  }, [sortMode]);

  return (
    <motion.div
      key="tasks"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <div className="mb-8 space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="text"
              data-testid="task-search-input"
              placeholder="Buscar tarefas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-white/10 dark:bg-white/5"
            />
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/80 p-3 dark:border-white/10 dark:bg-white/[0.03] md:min-w-[340px]">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              <ArrowUpDown size={14} />
              Ordenacao
            </div>
            <div className="flex flex-wrap gap-2">
              {SORT_OPTIONS.map((option) => {
                const isActive = sortMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    data-testid={`task-sort-${option.value}`}
                    onClick={() => handleSortChange(option.value)}
                    aria-pressed={isActive}
                    className={[
                      'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all',
                      isActive
                        ? 'bg-slate-900 text-white shadow-md dark:bg-white dark:text-slate-900'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10',
                    ].join(' ')}
                  >
                    {option.value === 'category' ? <ArrowDownAZ size={14} /> : <ArrowUpDown size={14} />}
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span
                data-testid="task-sort-summary"
                className="inline-flex h-7 items-center rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-600 dark:bg-white/5 dark:text-slate-300"
              >
                Ordenado por {activeSortLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 md:hidden">
          <FilterTag active={filterCategory === 'Todas'} onClick={() => setFilterCategory('Todas')} label="Todas" />
          {CATEGORIES.map((cat) => (
            <FilterTag key={cat} active={filterCategory === cat} onClick={() => setFilterCategory(cat)} label={cat} />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <AnimatePresence>
          {sortedPendingTasks.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  {sortedPendingTasks.length} tarefa{sortedPendingTasks.length === 1 ? '' : 's'} pendente{sortedPendingTasks.length === 1 ? '' : 's'}
                </p>
              </div>

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
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-3xl border border-dashed border-slate-200 bg-white/30 py-20 text-center dark:border-white/10 dark:bg-white/5"
            >
              <Sparkles size={32} className="mx-auto mb-4 text-slate-400" />
              <h3 className="mb-2 text-lg font-semibold">Nada por aqui</h3>
              <p className="mb-6 text-slate-500">Nenhuma tarefa encontrada.</p>
              <button
                onClick={onNewTask}
                className="rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white transition-transform active:scale-95 dark:bg-white dark:text-slate-900"
              >
                Criar Tarefa
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showCompleted && filterCategory === 'Todas' && !search && sortedCompletedTasks.length > 0 && (
        <div className="mt-12 space-y-4 opacity-60">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
              Concluidas ({sortedCompletedTasks.length})
            </h3>
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
          <PaginationControls
            totalItems={sortedCompletedTasks.length}
            currentPage={completedPage}
            onPageChange={setCompletedPage}
            testIdPrefix="completed-pagination"
          />
        </div>
      )}
    </motion.div>
  );
}
