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
    [filteredTasks, sortMode],
  );

  const sortedCompletedTasks = React.useMemo(
    () => sortTasks(completedTasks, sortMode),
    [completedTasks, sortMode],
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

  const activeSortLabel = React.useMemo(
    () => SORT_OPTIONS.find((option) => option.value === sortMode)?.label ?? 'Recentes',
    [sortMode],
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
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div>
            <span className="section-eyebrow">
              <ArrowUpDown size={14} />
              Organização da agenda
            </span>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Filtre, ordene e acompanhe cada entrega com clareza.
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
              Use pesquisa, categorias e ordenação para localizar rapidamente o que precisa ser feito agora.
            </p>
          </div>

          <div className="surface-soft p-4">
            <div className="relative">
              <Search className="field-icon" size={18} />
              <input
                type="text"
                data-testid="task-search-input"
                placeholder="Buscar lembretes por título"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="field-control field-control-with-icon"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
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
                        ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-[0_12px_24px_-18px_rgba(37,99,235,0.7)]'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]',
                    ].join(' ')}
                  >
                    {option.value === 'category' ? <ArrowDownAZ size={14} /> : <ArrowUpDown size={14} />}
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <span
                data-testid="task-sort-summary"
                className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300"
              >
                Ordenado por {activeSortLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto pb-1 md:hidden">
          <FilterTag
            active={filterCategory === 'Todas'}
            onClick={() => setFilterCategory('Todas')}
            label="Todas"
          />
          {CATEGORIES.map((category) => (
            <FilterTag
              key={category}
              active={filterCategory === category}
              onClick={() => setFilterCategory(category)}
              label={category}
            />
          ))}
        </div>
      </section>

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

      {showCompleted && filterCategory === 'Todas' && !search && sortedCompletedTasks.length > 0 && (
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
