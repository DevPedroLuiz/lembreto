import type { Priority, Status, Task, TaskTaxonomy } from '../types';

export type TaskCreatePayload = {
  title: string;
  description: string;
  dueDate: string;
  endDate?: string | null;
  priority: Priority;
  category: string;
  tags: string[];
  suppressHolidayNotifications: boolean;
  alarmEnabled?: boolean;
  mutedUntil?: string | null;
  noTimeReminderMinutes?: number;
  status?: Status;
};

export interface OfflineTaskCreate {
  id: string;
  userId: string;
  payload: TaskCreatePayload;
  createdAt: string;
}

const OFFLINE_CREATES_KEY = 'tm_offline_task_creates';
const TASK_CACHE_PREFIX = 'tm_tasks_cache:';
const TASK_TAXONOMY_CACHE_PREFIX = 'tm_task_taxonomy_cache:';

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getOfflineCreates(): OfflineTaskCreate[] {
  return safeParse<OfflineTaskCreate[]>(localStorage.getItem(OFFLINE_CREATES_KEY), [])
    .filter((item) => item && typeof item.id === 'string' && typeof item.userId === 'string');
}

function saveOfflineCreates(items: OfflineTaskCreate[]) {
  localStorage.setItem(OFFLINE_CREATES_KEY, JSON.stringify(items));
}

function createLocalId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getOfflineTaskId(queueId: string) {
  return `offline-${queueId}`;
}

export function getQueueIdFromOfflineTaskId(taskId: string) {
  return taskId.startsWith('offline-') ? taskId.slice('offline-'.length) : null;
}

export function loadOfflineTaskCreates(userId: string): OfflineTaskCreate[] {
  return getOfflineCreates().filter((item) => item.userId === userId);
}

export function enqueueOfflineTaskCreate(userId: string, payload: TaskCreatePayload): OfflineTaskCreate {
  const item: OfflineTaskCreate = {
    id: createLocalId(),
    userId,
    payload,
    createdAt: new Date().toISOString(),
  };

  saveOfflineCreates([...getOfflineCreates(), item]);
  return item;
}

export function updateOfflineTaskCreate(queueId: string, payload: Partial<TaskCreatePayload>) {
  const items = getOfflineCreates();
  const nextItems = items.map((item) => (
    item.id === queueId
      ? {
          ...item,
          payload: {
            ...item.payload,
            ...payload,
          },
        }
      : item
  ));
  saveOfflineCreates(nextItems);
}

export function removeOfflineTaskCreate(queueId: string) {
  saveOfflineCreates(getOfflineCreates().filter((item) => item.id !== queueId));
}

export function buildOfflineTask(item: OfflineTaskCreate): Task {
  return {
    id: getOfflineTaskId(item.id),
    userId: item.userId,
    title: item.payload.title,
    description: item.payload.description,
    dueDate: item.payload.dueDate,
    endDate: item.payload.endDate ?? null,
    priority: item.payload.priority,
    category: item.payload.category,
    tags: item.payload.tags,
    suppressHolidayNotifications: item.payload.suppressHolidayNotifications,
    alarmEnabled: item.payload.alarmEnabled ?? false,
    status: item.payload.status ?? 'pending',
    createdAt: item.createdAt,
    syncStatus: 'pending',
    history: [
      {
        id: `offline-history-${item.id}`,
        action: 'created',
        title: 'Lembrete salvo offline',
        description: 'Este lembrete sera sincronizado quando a conexao voltar.',
        createdAt: item.createdAt,
      },
    ],
  };
}

export function mergeTasksWithOfflineCreates(tasks: Task[], offlineCreates: OfflineTaskCreate[]): Task[] {
  return [
    ...offlineCreates.map(buildOfflineTask),
    ...tasks,
  ];
}

export function saveTaskCache(userId: string, tasks: Task[]) {
  const syncedTasks = tasks.filter((task) => task.syncStatus !== 'pending');
  localStorage.setItem(`${TASK_CACHE_PREFIX}${userId}`, JSON.stringify(syncedTasks));
}

export function loadTaskCache(userId: string): Task[] {
  return safeParse<Task[]>(localStorage.getItem(`${TASK_CACHE_PREFIX}${userId}`), []);
}

export function saveTaskTaxonomyCache(userId: string, taxonomy: TaskTaxonomy) {
  localStorage.setItem(`${TASK_TAXONOMY_CACHE_PREFIX}${userId}`, JSON.stringify(taxonomy));
}

export function loadTaskTaxonomyCache(userId: string): TaskTaxonomy {
  return safeParse<TaskTaxonomy>(
    localStorage.getItem(`${TASK_TAXONOMY_CACHE_PREFIX}${userId}`),
    { categories: [], tags: [] },
  );
}

export function mergeTaxonomyWithOfflineCreates(
  taxonomy: TaskTaxonomy,
  offlineCreates: OfflineTaskCreate[],
): TaskTaxonomy {
  return {
    categories: Array.from(new Set([
      ...taxonomy.categories,
      ...offlineCreates.map((item) => item.payload.category),
    ].filter(Boolean))),
    tags: Array.from(new Set([
      ...taxonomy.tags,
      ...offlineCreates.flatMap((item) => item.payload.tags ?? []),
    ].filter(Boolean))),
  };
}

export function isOfflineRequestError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (error instanceof TypeError) return true;
  return error instanceof Error && /fetch|network|failed/i.test(error.message);
}
