import React from 'react';
import {
  ArrowDownAZ,
  ArrowUpDown,
  CalendarDays,
  CalendarRange,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleDot,
  Flag,
  Hash,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
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
type TagFilter = 'all' | string;
type DateFilterMode = 'all' | 'day' | 'range' | 'week' | 'month' | 'year';
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

const DATE_FILTER_OPTIONS: Array<{ value: DateFilterMode; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'day', label: 'Dia' },
  { value: 'range', label: 'Período' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
  { value: 'year', label: 'Ano' },
];

const WEEKDAY_LABELS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

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

function isDateFilterMode(value: unknown): value is DateFilterMode {
  return value === 'all' || value === 'day' || value === 'range' || value === 'week' || value === 'month' || value === 'year';
}

function normalizeTagFilter(value: unknown, tags: string[]): TagFilter {
  if (value === 'all') return 'all';
  if (typeof value !== 'string') return 'all';
  return tags.includes(value) ? value : 'all';
}

interface TasksPageProps {
  pendingTasks: Task[];
  completedTasks: Task[];
  categories: string[];
  tags: string[];
  filterCategory: string;
  setFilterCategory: (category: string) => void;
  search: string;
  setSearch: (value: string) => void;
  showCompleted: boolean;
  onNewTask: () => void;
  onToggle: (task: Task) => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
  onDeleteSelected: (ids: string[]) => void;
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

function buildSelectableTaskIds(tasks: Task[]): Set<string> {
  return new Set(tasks.map((task) => task.id));
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string | undefined | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return formatDateKey(date) === value ? date : null;
}

function normalizeDateKey(value: unknown): string {
  return typeof value === 'string' && parseDateKey(value) ? value : '';
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
  return weekStart;
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function getDateFilterRange(
  mode: DateFilterMode,
  startDateKey: string,
  endDateKey: string,
): { start: string; end: string } | null {
  if (mode === 'all') return null;

  const startDate = parseDateKey(startDateKey);
  if (!startDate) return null;

  if (mode === 'day') return { start: startDateKey, end: startDateKey };

  if (mode === 'week') {
    const weekStart = startOfWeek(startDate);
    return {
      start: formatDateKey(weekStart),
      end: formatDateKey(addCalendarDays(weekStart, 6)),
    };
  }

  if (mode === 'month') {
    return {
      start: formatDateKey(new Date(startDate.getFullYear(), startDate.getMonth(), 1)),
      end: formatDateKey(endOfMonth(startDate)),
    };
  }

  if (mode === 'year') {
    return {
      start: formatDateKey(new Date(startDate.getFullYear(), 0, 1)),
      end: formatDateKey(new Date(startDate.getFullYear(), 11, 31)),
    };
  }

  const endDate = parseDateKey(endDateKey);
  if (!endDate) return { start: startDateKey, end: startDateKey };

  return startDate.getTime() <= endDate.getTime()
    ? { start: startDateKey, end: endDateKey }
    : { start: endDateKey, end: startDateKey };
}

function buildCalendarDays(cursorDate: Date): Date[] {
  const firstDay = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
  const calendarStart = startOfWeek(firstDay);

  return Array.from({ length: 42 }, (_, index) => addCalendarDays(calendarStart, index));
}

function formatDateLabel(value: string): string {
  const date = parseDateKey(value);
  if (!date) return 'Sem data';

  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
}

function matchesDateFilter(task: Task, range: { start: string; end: string } | null): boolean {
  if (!range) return true;

  const dueDate = new Date(task.dueDate);
  if (Number.isNaN(dueDate.getTime())) return false;

  const dueDateKey = formatDateKey(dueDate);
  return dueDateKey >= range.start && dueDateKey <= range.end;
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
  tagFilter: TagFilter,
  dateRange: { start: string; end: string } | null,
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
  const matchesTag = tagFilter === 'all' || (task.tags ?? []).includes(tagFilter);
  const matchesDate = matchesDateFilter(task, dateRange);

  return matchesSearch && matchesCategory && matchesPriority && matchesTag && matchesDate;
}

function hasStoredCustomFilters(
  search: string,
  filterCategory: string,
  sortMode: SortMode,
  priorityFilter: PriorityFilter,
  statusFilter: StatusFilter,
  tagFilter: TagFilter,
  dateFilterMode: DateFilterMode,
) {
  return (
    search.trim().length > 0 ||
    filterCategory !== 'Todas' ||
    sortMode !== 'created' ||
    priorityFilter !== 'all' ||
    statusFilter !== 'all' ||
    tagFilter !== 'all' ||
    dateFilterMode !== 'all'
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
  tags,
  filterCategory,
  setFilterCategory,
  search,
  setSearch,
  showCompleted,
  onNewTask,
  onToggle,
  onDelete,
  onDeleteSelected,
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
  const availableTags = React.useMemo(
    () => buildAvailableTags(tags, [...pendingTasks, ...completedTasks]),
    [completedTasks, pendingTasks, tags],
  );
  const config = React.useMemo(() => LS.getConfig(), []);
  const initialSortMode = isSortMode(config.taskSortMode) ? config.taskSortMode : 'created';
  const initialPriorityFilter = isPriorityFilter(config.taskPriorityFilter) ? config.taskPriorityFilter : 'all';
  const initialStatusFilter = isStatusFilter(config.taskStatusFilter) ? config.taskStatusFilter : 'all';
  const initialTagFilter = normalizeTagFilter(config.taskTagFilter, availableTags);
  const todayKey = React.useMemo(() => formatDateKey(new Date()), []);
  const initialDateFilterMode = isDateFilterMode(config.taskDateFilterMode) ? config.taskDateFilterMode : 'all';
  const initialDateFilterStart = normalizeDateKey(config.taskDateFilterStart) || todayKey;
  const initialDateFilterEnd = normalizeDateKey(config.taskDateFilterEnd);

  const [pendingPage, setPendingPage] = React.useState(1);
  const [completedPage, setCompletedPage] = React.useState(1);
  const [sortMode, setSortMode] = React.useState<SortMode>(initialSortMode);
  const [priorityFilter, setPriorityFilter] = React.useState<PriorityFilter>(initialPriorityFilter);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>(initialStatusFilter);
  const [tagFilter, setTagFilter] = React.useState<TagFilter>(initialTagFilter);
  const [dateFilterMode, setDateFilterMode] = React.useState<DateFilterMode>(initialDateFilterMode);
  const [dateFilterStart, setDateFilterStart] = React.useState(initialDateFilterStart);
  const [dateFilterEnd, setDateFilterEnd] = React.useState(initialDateFilterEnd);
  const [calendarCursor, setCalendarCursor] = React.useState(
    () => parseDateKey(initialDateFilterStart) ?? new Date(),
  );
  const [filtersOpen, setFiltersOpen] = React.useState(() =>
    hasStoredCustomFilters(
      search,
      filterCategory,
      initialSortMode,
      initialPriorityFilter,
      initialStatusFilter,
      initialTagFilter,
      initialDateFilterMode,
    ),
  );
  const [activeView, setActiveView] = React.useState<TasksPageView>('agenda');
  const [searchInput, setSearchInput] = React.useState(search);
  const [selectedTaskIds, setSelectedTaskIds] = React.useState<Set<string>>(new Set());
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

  const handleTagFilterChange = React.useCallback((nextTagFilter: TagFilter) => {
    setTagFilter(nextTagFilter);
    const currentConfig = LS.getConfig();
    LS.saveConfig({
      ...currentConfig,
      taskTagFilter: nextTagFilter,
    });
  }, []);

  const saveDateFilter = React.useCallback((
    nextMode: DateFilterMode,
    nextStart: string,
    nextEnd: string,
  ) => {
    const currentConfig = LS.getConfig();
    LS.saveConfig({
      ...currentConfig,
      taskDateFilterMode: nextMode,
      taskDateFilterStart: nextStart,
      taskDateFilterEnd: nextEnd,
    });
  }, []);

  const updateDateFilter = React.useCallback((
    nextMode: DateFilterMode,
    nextStart = dateFilterStart || todayKey,
    nextEnd = dateFilterEnd,
  ) => {
    const normalizedStart = normalizeDateKey(nextStart) || todayKey;
    const normalizedEnd = normalizeDateKey(nextEnd);
    const startDate = parseDateKey(normalizedStart);

    setDateFilterMode(nextMode);
    setDateFilterStart(normalizedStart);
    setDateFilterEnd(nextMode === 'range' ? normalizedEnd : '');
    if (startDate) setCalendarCursor(startDate);
    saveDateFilter(nextMode, normalizedStart, nextMode === 'range' ? normalizedEnd : '');
  }, [dateFilterEnd, dateFilterStart, saveDateFilter, todayKey]);

  const handleDateModeChange = React.useCallback((nextMode: DateFilterMode) => {
    if (nextMode === 'all') {
      updateDateFilter('all', dateFilterStart || todayKey, dateFilterEnd);
      return;
    }

    if (nextMode === 'range') {
      updateDateFilter('range', dateFilterStart || todayKey, dateFilterEnd);
      return;
    }

    updateDateFilter(nextMode, dateFilterStart || todayKey, '');
  }, [dateFilterEnd, dateFilterStart, todayKey, updateDateFilter]);

  const handleDateStartChange = React.useCallback((nextStart: string) => {
    const normalizedStart = normalizeDateKey(nextStart);
    if (!normalizedStart) return;
    updateDateFilter(dateFilterMode === 'all' ? 'day' : dateFilterMode, normalizedStart, dateFilterEnd);
  }, [dateFilterEnd, dateFilterMode, updateDateFilter]);

  const handleDateEndChange = React.useCallback((nextEnd: string) => {
    updateDateFilter('range', dateFilterStart || todayKey, nextEnd);
  }, [dateFilterStart, todayKey, updateDateFilter]);

  const handleCalendarDayClick = React.useCallback((dateKey: string) => {
    if (dateFilterMode === 'range') {
      if (!dateFilterStart || dateFilterEnd || dateKey < dateFilterStart) {
        updateDateFilter('range', dateKey, '');
        return;
      }

      updateDateFilter('range', dateFilterStart, dateKey);
      return;
    }

    updateDateFilter(dateFilterMode === 'all' ? 'day' : dateFilterMode, dateKey, '');
  }, [dateFilterEnd, dateFilterMode, dateFilterStart, updateDateFilter]);

  const handleMonthInputChange = React.useCallback((nextMonth: string) => {
    if (!/^\d{4}-\d{2}$/.test(nextMonth)) return;
    updateDateFilter('month', `${nextMonth}-01`, '');
  }, [updateDateFilter]);

  const handleYearInputChange = React.useCallback((nextYear: string) => {
    if (!/^\d{4}$/.test(nextYear)) return;
    updateDateFilter('year', `${nextYear}-01-01`, '');
  }, [updateDateFilter]);

  const handleCalendarMonthChange = React.useCallback((offset: number) => {
    setCalendarCursor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }, []);

  React.useEffect(() => {
    if (tagFilter === 'all') return;
    if (availableTags.includes(tagFilter)) return;

    setTagFilter('all');
    const currentConfig = LS.getConfig();
    LS.saveConfig({
      ...currentConfig,
      taskTagFilter: 'all',
    });
  }, [availableTags, tagFilter]);

  const normalizedSearch = React.useMemo(
    () => search.trim().toLocaleLowerCase('pt-BR'),
    [search],
  );

  const activeDateRange = React.useMemo(
    () => getDateFilterRange(dateFilterMode, dateFilterStart, dateFilterEnd),
    [dateFilterEnd, dateFilterMode, dateFilterStart],
  );

  const calendarDays = React.useMemo(
    () => buildCalendarDays(calendarCursor),
    [calendarCursor],
  );

  const locallyFilteredPendingTasks = React.useMemo(
    () => pendingTasks.filter((task) => matchesTaskFilters(task, normalizedSearch, filterCategory, priorityFilter, tagFilter, activeDateRange)),
    [activeDateRange, filterCategory, normalizedSearch, pendingTasks, priorityFilter, tagFilter],
  );

  const locallyFilteredCompletedTasks = React.useMemo(
    () => completedTasks.filter((task) => matchesTaskFilters(task, normalizedSearch, filterCategory, priorityFilter, tagFilter, activeDateRange)),
    [activeDateRange, completedTasks, filterCategory, normalizedSearch, priorityFilter, tagFilter],
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

  const selectableTasks = React.useMemo(
    () => [...sortedPendingTasks, ...sortedCompletedTasks],
    [sortedCompletedTasks, sortedPendingTasks],
  );

  const selectableTaskIds = React.useMemo(
    () => buildSelectableTaskIds(selectableTasks),
    [selectableTasks],
  );

  React.useEffect(() => {
    setSelectedTaskIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (selectableTaskIds.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [selectableTaskIds]);

  const selectedCount = selectedTaskIds.size;
  const allSelectableSelected = selectableTasks.length > 0 && selectedCount === selectableTasks.length;

  const handleSelectionChange = React.useCallback((task: Task, selected: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(task.id);
      else next.delete(task.id);
      return next;
    });
  }, []);

  const handleToggleSelectAll = React.useCallback(() => {
    setSelectedTaskIds((prev) => {
      if (selectableTasks.length === 0) return prev;
      if (prev.size === selectableTasks.length) return new Set<string>();
      return new Set(selectableTasks.map((task) => task.id));
    });
  }, [selectableTasks]);

  const handleDeleteSelected = React.useCallback(() => {
    if (selectedTaskIds.size === 0) return;
    onDeleteSelected(Array.from(selectedTaskIds));
    setSelectedTaskIds(new Set());
  }, [onDeleteSelected, selectedTaskIds]);

  const pendingTotalPages = Math.max(1, Math.ceil(sortedPendingTasks.length / PAGE_SIZE));
  const completedTotalPages = Math.max(1, Math.ceil(sortedCompletedTasks.length / PAGE_SIZE));

  React.useEffect(() => {
    setPendingPage(1);
  }, [dateFilterEnd, dateFilterMode, dateFilterStart, filterCategory, priorityFilter, search, sortMode, statusFilter, tagFilter]);

  React.useEffect(() => {
    setCompletedPage(1);
  }, [dateFilterEnd, dateFilterMode, dateFilterStart, filterCategory, priorityFilter, search, sortMode, statusFilter, tagFilter]);

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
  const activeTagLabel = React.useMemo(
    () => (tagFilter === 'all' ? 'Todas as tags' : tagFilter),
    [tagFilter],
  );
  const activeDateLabel = React.useMemo(() => {
    if (!activeDateRange) return 'Todas as datas';
    if (activeDateRange.start === activeDateRange.end) return formatDateLabel(activeDateRange.start);
    return `${formatDateLabel(activeDateRange.start)} até ${formatDateLabel(activeDateRange.end)}`;
  }, [activeDateRange]);
  const calendarMonthLabel = React.useMemo(
    () => formatMonthLabel(calendarCursor),
    [calendarCursor],
  );

  const totalVisibleTasks = sortedPendingTasks.length + sortedCompletedTasks.length;
  const hasCustomFilters = hasStoredCustomFilters(
    search,
    filterCategory,
    sortMode,
    priorityFilter,
    statusFilter,
    tagFilter,
    dateFilterMode,
  );
  const activeFilterCount = [
    filterCategory !== 'Todas',
    sortMode !== 'created',
    priorityFilter !== 'all',
    statusFilter !== 'all',
    tagFilter !== 'all',
    dateFilterMode !== 'all',
    search.trim().length > 0,
  ].filter(Boolean).length;

  const handleResetFilters = React.useCallback(() => {
    setSearchInput('');
    setSearch('');
    setFilterCategory('Todas');
    setSortMode('created');
    setPriorityFilter('all');
    setStatusFilter('all');
    setTagFilter('all');
    setDateFilterMode('all');
    setDateFilterStart(todayKey);
    setDateFilterEnd('');
    setCalendarCursor(parseDateKey(todayKey) ?? new Date());
    setFiltersOpen(false);

    const currentConfig = LS.getConfig();
    LS.saveConfig({
      ...currentConfig,
      taskSortMode: 'created',
      taskPriorityFilter: 'all',
      taskStatusFilter: 'all',
      taskTagFilter: 'all',
      taskDateFilterMode: 'all',
      taskDateFilterStart: todayKey,
      taskDateFilterEnd: '',
    });
  }, [setFilterCategory, setSearch, todayKey]);

  const filtersPanel = (
    <div className="surface-soft max-w-6xl overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-slate-200/70 bg-slate-50/70 px-4 py-4 dark:border-white/10 dark:bg-white/[0.03] sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Filtros da agenda</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Combine busca, data, categoria e status para chegar no lembrete certo.
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

      <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(300px,0.92fr)_minmax(0,1.08fr)]">
        <section className="rounded-3xl border border-slate-200/70 bg-white/76 p-4 dark:border-white/10 dark:bg-slate-950/36">
          <div className="mb-4 flex items-start gap-3">
            <span className="icon-slot h-9 w-9 rounded-2xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
              <CalendarRange size={17} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Data do lembrete</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Filtre por um dia, período, semana, mês ou ano.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DATE_FILTER_OPTIONS.map((option) => {
              const isActive = dateFilterMode === option.value;
              return (
                <ControlButton
                  key={option.value}
                  type="button"
                  data-testid={`task-date-filter-${option.value}`}
                  onClick={() => handleDateModeChange(option.value)}
                  aria-pressed={isActive}
                  active={isActive}
                  className="h-10 rounded-xl px-2 text-xs"
                >
                  {option.value === 'all' ? <Circle size={13} /> : <CalendarDays size={13} />}
                  {option.label}
                </ControlButton>
              );
            })}
          </div>

          {dateFilterMode !== 'all' && (
            <div className="mt-4 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/[0.04]">
              {dateFilterMode === 'range' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    De
                    <input
                      type="date"
                      value={dateFilterStart}
                      onChange={(event) => handleDateStartChange(event.target.value)}
                      className="field-control mt-2 px-3 py-2.5"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Até
                    <input
                      type="date"
                      value={dateFilterEnd}
                      onChange={(event) => handleDateEndChange(event.target.value)}
                      className="field-control mt-2 px-3 py-2.5"
                    />
                  </label>
                </div>
              ) : dateFilterMode === 'month' ? (
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Mês de referência
                  <input
                    type="month"
                    value={dateFilterStart.slice(0, 7)}
                    onChange={(event) => handleMonthInputChange(event.target.value)}
                    className="field-control mt-2 px-3 py-2.5"
                  />
                </label>
              ) : dateFilterMode === 'year' ? (
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Ano de referência
                  <input
                    type="number"
                    min="1900"
                    max="2100"
                    value={dateFilterStart.slice(0, 4)}
                    onChange={(event) => handleYearInputChange(event.target.value)}
                    className="field-control mt-2 px-3 py-2.5"
                  />
                </label>
              ) : (
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Data de referência
                  <input
                    type="date"
                    value={dateFilterStart}
                    onChange={(event) => handleDateStartChange(event.target.value)}
                    className="field-control mt-2 px-3 py-2.5"
                  />
                </label>
              )}
            </div>
          )}

          <div className="mt-4 rounded-3xl border border-slate-200/70 bg-white p-3 shadow-[0_14px_34px_-30px_rgba(15,23,42,0.5)] dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label="Mes anterior"
                onClick={() => handleCalendarMonthChange(-1)}
                className="action-ghost h-9 w-9 rounded-xl p-0"
              >
                <ChevronLeft size={16} />
              </button>
              <p className="text-sm font-semibold capitalize text-slate-900 dark:text-white">
                {calendarMonthLabel}
              </p>
              <button
                type="button"
                aria-label="Próximo mês"
                onClick={() => handleCalendarMonthChange(1)}
                className="action-ghost h-9 w-9 rounded-xl p-0"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-slate-400 dark:text-slate-500">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={`${label}-${index}`} className="py-1">
                  {label}
                </span>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                const dayKey = formatDateKey(day);
                const isCurrentMonth = day.getMonth() === calendarCursor.getMonth();
                const isToday = dayKey === todayKey;
                const isInRange = Boolean(activeDateRange && dayKey >= activeDateRange.start && dayKey <= activeDateRange.end);
                const isRangeEdge = Boolean(activeDateRange && (dayKey === activeDateRange.start || dayKey === activeDateRange.end));

                return (
                  <button
                    key={dayKey}
                    type="button"
                    onClick={() => handleCalendarDayClick(dayKey)}
                    aria-pressed={isInRange}
                    className={[
                      'h-9 rounded-xl text-xs font-semibold transition-all',
                      isRangeEdge
                        ? 'bg-blue-600 text-white shadow-[0_12px_24px_-18px_rgba(37,99,235,0.8)]'
                        : isInRange
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-200'
                          : isToday
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                            : isCurrentMonth
                              ? 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.08]'
                              : 'text-slate-300 hover:bg-slate-50 dark:text-slate-700 dark:hover:bg-white/[0.04]',
                    ].join(' ')}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <p className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 dark:bg-white/[0.05] dark:text-slate-300">
              {dateFilterMode === 'all' ? 'Calendário pronto para selecionar uma data.' : activeDateLabel}
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="relative">
            <Search className="field-icon" size={18} />
            <input
              type="text"
              data-testid="task-search-input"
              placeholder="Buscar lembretes por título, descrição ou tag"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="field-control field-control-with-icon"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="icon-slot h-8 w-8 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                  <SlidersHorizontal size={15} />
                </span>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Ordenação</p>
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

          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
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
              <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Categorias</p>
              <div className="flex flex-wrap gap-2">
                <ControlButton
                  type="button"
                  data-testid="task-category-filter-all"
                  onClick={() => setFilterCategory('Todas')}
                  aria-pressed={filterCategory === 'Todas'}
                  active={filterCategory === 'Todas'}
                >
                  <Hash size={14} />
                  Todas
                </ControlButton>
                {categories.map((category) => (
                  <ControlButton
                    key={category}
                    type="button"
                    data-testid={`task-category-filter-${category.toLocaleLowerCase('pt-BR').replace(/\s+/g, '-')}`}
                    onClick={() => setFilterCategory(category)}
                    aria-pressed={filterCategory === category}
                    active={filterCategory === category}
                  >
                    <Hash size={14} />
                    {category}
                  </ControlButton>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="icon-slot h-8 w-8 rounded-xl bg-sky-500/10 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
                <Hash size={15} />
              </span>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Tags</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <ControlButton
                type="button"
                data-testid="task-tag-filter-all"
                onClick={() => handleTagFilterChange('all')}
                aria-pressed={tagFilter === 'all'}
                active={tagFilter === 'all'}
              >
                <Hash size={14} />
                Todas as tags
              </ControlButton>

              {availableTags.map((tag) => {
                const isActive = tagFilter === tag;
                return (
                  <ControlButton
                    key={tag}
                    type="button"
                    data-testid={`task-tag-filter-${tag.toLocaleLowerCase('pt-BR').replace(/\s+/g, '-')}`}
                    onClick={() => handleTagFilterChange(tag)}
                    aria-pressed={isActive}
                    active={isActive}
                  >
                    <Hash size={14} />
                    {tag}
                  </ControlButton>
                );
              })}
            </div>

            {availableTags.length === 0 && (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Nenhuma tag foi usada ainda nos seus lembretes.
              </p>
            )}
          </div>
        </section>
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
              <span
                data-testid="task-tag-summary"
                className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300"
              >
                Tag: {activeTagLabel}
              </span>
              <span
                data-testid="task-date-summary"
                className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300"
              >
                Data: {activeDateLabel}
              </span>
            </div>

            {selectedCount > 0 && (
              <div className="surface-soft flex flex-col gap-3 rounded-2xl border border-blue-200/70 px-4 py-3 dark:border-blue-400/20 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {selectedCount} lembrete{selectedCount === 1 ? '' : 's'} selecionado{selectedCount === 1 ? '' : 's'}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleToggleSelectAll}
                    className="action-secondary h-11 rounded-2xl px-4 py-0 text-sm"
                  >
                    <CheckCheck size={16} />
                    {allSelectableSelected ? 'Limpar seleção' : 'Selecionar todos'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-0 text-sm font-semibold text-white transition-all hover:bg-rose-700"
                  >
                    <Trash2 size={16} />
                    Excluir selecionados
                  </button>
                </div>
              </div>
            )}

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
                    onSelectionChange={handleSelectionChange}
                    showSelectionControl
                    onEdit={onEdit}
                    isSelected={selectedTaskIds.has(task.id)}
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
                onSelectionChange={handleSelectionChange}
                showSelectionControl
                onEdit={onEdit}
                isSelected={selectedTaskIds.has(task.id)}
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
