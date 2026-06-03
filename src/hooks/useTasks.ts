import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import {
  buildOfflineTask,
  enqueueOfflineTaskCreate,
  ensureTaskClientMutationId,
  getQueueIdFromOfflineTaskId,
  isOfflineRequestError,
  loadOfflineTaskCreates,
  loadTaskCache,
  loadTaskTaxonomyCache,
  mergeTasksWithOfflineCreates,
  mergeTaxonomyWithOfflineCreates,
  removeOfflineTaskCreate,
  saveTaskCache,
  saveTaskTaxonomyCache,
  updateOfflineTaskCreate,
  type TaskCreatePayload,
} from '../lib/offlineTasks';
import type {
  Priority,
  Status,
  Task,
  TaskListResponse,
  TaskOverdueReminderIntensity,
  TaskTaxonomy,
  User,
} from '../types';

type TaskPayload = TaskCreatePayload;
type InFlightRequest<T> = {
  key: string;
  promise: Promise<T>;
};

const SYNC_REFRESH_DEBOUNCE_MS = 15000;
const TASK_FOREGROUND_REFRESH_MIN_INTERVAL_MS = 60000;
const TASK_FETCH_PAGE_SIZE = 250;

function normalizeTaxonomy(data: TaskTaxonomy): TaskTaxonomy {
  return {
    categories: Array.isArray(data.categories) ? data.categories : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
}

function isTaskListResponse(data: TaskListResponse | Task[]): data is TaskListResponse {
  return typeof data === 'object' && data !== null && !Array.isArray(data) && Array.isArray(data.items);
}

function upsertCachedTask(userId: string, task: Task) {
  const cachedTasks = loadTaskCache(userId);
  const hasTask = cachedTasks.some((cachedTask) => cachedTask.id === task.id);
  saveTaskCache(
    userId,
    hasTask
      ? cachedTasks.map((cachedTask) => (cachedTask.id === task.id ? task : cachedTask))
      : [task, ...cachedTasks],
  );
}

function updateCachedTaskStatus(userId: string, taskId: string, status: Status) {
  const cachedTasks = loadTaskCache(userId);
  if (cachedTasks.length === 0) return;

  saveTaskCache(
    userId,
    cachedTasks.map((cachedTask) => (
      cachedTask.id === taskId ? { ...cachedTask, status } : cachedTask
    )),
  );
}

function upsertTaskList(tasks: Task[], task: Task): Task[] {
  return [task, ...tasks.filter((current) => current.id !== task.id)];
}

function normalizeOptionalTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function normalizeTags(tags: string[] | undefined): string {
  return [...(tags ?? [])].map((tag) => tag.trim()).filter(Boolean).sort().join('\n');
}

function taskMatchesCreatePayload(task: Task, payload: TaskPayload): boolean {
  if (task.clientMutationId && payload.clientMutationId && task.clientMutationId === payload.clientMutationId) {
    return true;
  }

  return task.title === payload.title
    && task.description === payload.description
    && normalizeOptionalTime(task.dueDate) === normalizeOptionalTime(payload.dueDate)
    && normalizeOptionalTime(task.endDate) === normalizeOptionalTime(payload.endDate)
    && task.priority === payload.priority
    && task.category === payload.category
    && task.suppressHolidayNotifications === payload.suppressHolidayNotifications
    && (task.overdueReminderIntensity ?? 'normal') === (payload.overdueReminderIntensity ?? 'normal')
    && task.alarmEnabled === (payload.alarmEnabled ?? false)
    && task.status === (payload.status ?? 'pending')
    && normalizeTags(task.tags) === normalizeTags(payload.tags);
}

function findOfflineTask(queueId: string, userId: string): Task {
  const item = loadOfflineTaskCreates(userId).find((current) => current.id === queueId);
  if (!item) throw new Error('Lembrete offline não encontrado');
  return buildOfflineTask(item);
}

export function useTasks(token: string | null, currentUser: User | null = null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [pendingOfflineTaskCount, setPendingOfflineTaskCount] = useState(0);
  const [isSyncingOfflineTasks, setIsSyncingOfflineTasks] = useState(false);
  const userId = currentUser?.id ?? null;
  const tasksFetchInFlightRef = useRef<InFlightRequest<Task[]> | null>(null);
  const taxonomyFetchInFlightRef = useRef<InFlightRequest<TaskTaxonomy> | null>(null);
  const offlineSyncInFlightRef = useRef<InFlightRequest<number> | null>(null);
  const listenerSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastListenerSyncAtRef = useRef(0);
  const lastFullRefreshAtRef = useRef(0);
  const tasksMutationVersionRef = useRef(0);
  const taxonomyMutationVersionRef = useRef(0);

  const applyCachedState = useCallback((requestUserId = userId) => {
    if (!requestUserId) {
      setTasks([]);
      setCategories([]);
      setTags([]);
      setPendingOfflineTaskCount(0);
      return;
    }

    const offlineCreates = loadOfflineTaskCreates(requestUserId);
    const cachedTasks = loadTaskCache(requestUserId);
    const cachedTaxonomy = mergeTaxonomyWithOfflineCreates(
      loadTaskTaxonomyCache(requestUserId),
      offlineCreates,
    );

    setTasks(mergeTasksWithOfflineCreates(cachedTasks, offlineCreates));
    setCategories(cachedTaxonomy.categories);
    setTags(cachedTaxonomy.tags);
    setPendingOfflineTaskCount(offlineCreates.length);
  }, [userId]);

  const fetchServerTasks = useCallback(async (
    requestToken: string,
    requestUserId: string,
  ): Promise<Task[]> => {
    while (tasksFetchInFlightRef.current) {
      const existingRequest = tasksFetchInFlightRef.current;
      if (existingRequest.key === requestUserId) return existingRequest.promise;
      await existingRequest.promise.catch(() => undefined);
    }

    const promise = (async () => {
      const firstPage = await apiGet<TaskListResponse | Task[]>(
        `/api/tasks?page=1&limit=${TASK_FETCH_PAGE_SIZE}&sort=created`,
        requestToken,
      );
      if (!isTaskListResponse(firstPage)) return Array.isArray(firstPage) ? firstPage : [];

      const allTasks = [...firstPage.items];
      for (let page = 2; page <= firstPage.totalPages; page += 1) {
        const response = await apiGet<TaskListResponse>(
          `/api/tasks?page=${page}&limit=${TASK_FETCH_PAGE_SIZE}&sort=created`,
          requestToken,
        );
        allTasks.push(...response.items);
      }

      return allTasks;
    })()
      .finally(() => {
        if (tasksFetchInFlightRef.current?.promise === promise) {
          tasksFetchInFlightRef.current = null;
        }
      });

    tasksFetchInFlightRef.current = { key: requestUserId, promise };
    return promise;
  }, []);

  const fetchServerTaxonomy = useCallback(async (
    requestToken: string,
    requestUserId: string,
  ): Promise<TaskTaxonomy> => {
    while (taxonomyFetchInFlightRef.current) {
      const existingRequest = taxonomyFetchInFlightRef.current;
      if (existingRequest.key === requestUserId) return existingRequest.promise;
      await existingRequest.promise.catch(() => undefined);
    }

    const promise = apiGet<TaskTaxonomy>('/api/tasks/metadata', requestToken)
      .then(normalizeTaxonomy)
      .finally(() => {
        if (taxonomyFetchInFlightRef.current?.promise === promise) {
          taxonomyFetchInFlightRef.current = null;
        }
      });

    taxonomyFetchInFlightRef.current = { key: requestUserId, promise };
    return promise;
  }, []);

  const refreshTasksAndTaxonomy = useCallback(async (
    requestToken = token,
    requestUserId = userId,
  ) => {
    if (!requestUserId) {
      setTasks([]);
      setCategories([]);
      setTags([]);
      setPendingOfflineTaskCount(0);
      setIsSyncingOfflineTasks(false);
      return;
    }

    if (!requestToken) {
      applyCachedState(requestUserId);
      return;
    }

    const startedTasksMutationVersion = tasksMutationVersionRef.current;
    const startedTaxonomyMutationVersion = taxonomyMutationVersionRef.current;
    const [syncedTasks, syncedTaxonomy] = await Promise.all([
      fetchServerTasks(requestToken, requestUserId),
      fetchServerTaxonomy(requestToken, requestUserId),
    ]);
    const offlineCreates = loadOfflineTaskCreates(requestUserId);

    if (tasksMutationVersionRef.current === startedTasksMutationVersion) {
      saveTaskCache(requestUserId, syncedTasks);
      setTasks(mergeTasksWithOfflineCreates(syncedTasks, offlineCreates));
    }

    if (taxonomyMutationVersionRef.current === startedTaxonomyMutationVersion) {
      saveTaskTaxonomyCache(requestUserId, syncedTaxonomy);
      const mergedTaxonomy = mergeTaxonomyWithOfflineCreates(syncedTaxonomy, offlineCreates);
      setCategories(mergedTaxonomy.categories);
      setTags(mergedTaxonomy.tags);
    }
    setPendingOfflineTaskCount(offlineCreates.length);
    lastFullRefreshAtRef.current = Date.now();
  }, [applyCachedState, fetchServerTasks, fetchServerTaxonomy, token, userId]);

  const syncOfflineTasks = useCallback(async (requestToken = token, requestUserId = userId) => {
    if (!requestToken || !requestUserId) return 0;

    const existingSync = offlineSyncInFlightRef.current;
    if (existingSync) return existingSync.promise;

    const syncPromise = (async () => {
      const offlineCreates = loadOfflineTaskCreates(requestUserId);
      if (offlineCreates.length === 0) {
        setPendingOfflineTaskCount(0);
        return 0;
      }

      let syncedCount = 0;
      let knownSyncedTasks = loadTaskCache(requestUserId);
      setIsSyncingOfflineTasks(true);

      try {
        for (const item of offlineCreates) {
          if (knownSyncedTasks.some((task) => taskMatchesCreatePayload(task, item.payload))) {
            removeOfflineTaskCreate(item.id);
            syncedCount += 1;
            continue;
          }

          try {
            const created = await apiPost<Task>('/api/tasks', item.payload, requestToken);
            removeOfflineTaskCreate(item.id);
            syncedCount += 1;
            knownSyncedTasks = upsertTaskList(knownSyncedTasks, created);

            const offlineTaskId = buildOfflineTask(item).id;
            setTasks((prev) => prev.map((task) => (task.id === offlineTaskId ? created : task)));
            setCategories((prev) => Array.from(new Set([...prev, created.category])));
            setTags((prev) => Array.from(new Set([...prev, ...(created.tags ?? [])])));
          } catch (error) {
            if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
              removeOfflineTaskCreate(item.id);
              syncedCount += 1;
              continue;
            }

            if (isOfflineRequestError(error)) break;
            throw error;
          }
        }

        const remainingCreates = loadOfflineTaskCreates(requestUserId);
        setPendingOfflineTaskCount(remainingCreates.length);

        if (syncedCount > 0) {
          await refreshTasksAndTaxonomy(requestToken, requestUserId).catch(() => {
            // Local optimistic state stays available if the follow-up refresh fails.
          });
        }

        return syncedCount;
      } finally {
        setIsSyncingOfflineTasks(false);
      }
    })().finally(() => {
      if (offlineSyncInFlightRef.current?.promise === syncPromise) {
        offlineSyncInFlightRef.current = null;
      }
    });

    offlineSyncInFlightRef.current = { key: requestUserId, promise: syncPromise };
    return syncPromise;
  }, [refreshTasksAndTaxonomy, token, userId]);

  const refreshTasks = useCallback(async (requestToken = token) => {
    if (!userId) {
      setTasks([]);
      return;
    }

    if (!requestToken) {
      setTasks(mergeTasksWithOfflineCreates(loadTaskCache(userId), loadOfflineTaskCreates(userId)));
      return;
    }

    const syncedTasks = await fetchServerTasks(requestToken, userId);
    saveTaskCache(userId, syncedTasks);
    setTasks(mergeTasksWithOfflineCreates(syncedTasks, loadOfflineTaskCreates(userId)));
    lastFullRefreshAtRef.current = Date.now();
  }, [fetchServerTasks, token, userId]);

  const refreshTaxonomy = useCallback(async (requestToken = token) => {
    if (!userId) {
      setCategories([]);
      setTags([]);
      return;
    }

    if (!requestToken) {
      const taxonomy = mergeTaxonomyWithOfflineCreates(
        loadTaskTaxonomyCache(userId),
        loadOfflineTaskCreates(userId),
      );
      setCategories(taxonomy.categories);
      setTags(taxonomy.tags);
      return;
    }

    const taxonomy = await fetchServerTaxonomy(requestToken, userId);
    saveTaskTaxonomyCache(userId, taxonomy);

    const mergedTaxonomy = mergeTaxonomyWithOfflineCreates(taxonomy, loadOfflineTaskCreates(userId));
    setCategories(mergedTaxonomy.categories);
    setTags(mergedTaxonomy.tags);
  }, [fetchServerTaxonomy, token, userId]);

  useEffect(() => {
    if (!userId) {
      applyCachedState(null);
      return;
    }

    applyCachedState(userId);

    if (!token) return;

    void (async () => {
      try {
        const hasOfflineCreates = loadOfflineTaskCreates(userId).length > 0;
        const syncedCount = hasOfflineCreates ? await syncOfflineTasks(token, userId) : 0;
        if (!hasOfflineCreates || syncedCount === 0) {
          await refreshTasksAndTaxonomy(token, userId);
        }
      } catch {
        applyCachedState(userId);
      }
    })();
  }, [applyCachedState, refreshTasksAndTaxonomy, syncOfflineTasks, token, userId]);

  useEffect(() => {
    if (!token || !userId) return undefined;

    const sync = () => {
      if (document.visibilityState === 'hidden') return;
      if (
        offlineSyncInFlightRef.current
        || tasksFetchInFlightRef.current
        || taxonomyFetchInFlightRef.current
      ) {
        return;
      }

      if (listenerSyncTimeoutRef.current) return;

      const elapsed = Date.now() - lastListenerSyncAtRef.current;
      const delay = Math.max(0, SYNC_REFRESH_DEBOUNCE_MS - elapsed);
      const run = () => {
        listenerSyncTimeoutRef.current = null;
        if (
          document.visibilityState === 'hidden'
          || offlineSyncInFlightRef.current
          || tasksFetchInFlightRef.current
          || taxonomyFetchInFlightRef.current
        ) {
          return;
        }

        lastListenerSyncAtRef.current = Date.now();
        void (async () => {
          await syncOfflineTasks(token, userId);
          if (Date.now() - lastFullRefreshAtRef.current >= TASK_FOREGROUND_REFRESH_MIN_INTERVAL_MS) {
            await refreshTasksAndTaxonomy(token, userId);
          }
        })().catch(() => {
          // Keep the current local state if the foreground refresh cannot reach the server.
        });
      };

      if (delay > 0) {
        listenerSyncTimeoutRef.current = setTimeout(run, delay);
        return;
      }

      run();
    };

    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);

    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
      if (listenerSyncTimeoutRef.current) {
        clearTimeout(listenerSyncTimeoutRef.current);
        listenerSyncTimeoutRef.current = null;
      }
    };
  }, [refreshTasksAndTaxonomy, syncOfflineTasks, token, userId]);

  const createTask = useCallback(async (payload: TaskPayload) => {
    if (!userId) throw new Error('Não autenticado');
    const payloadWithMutationId = ensureTaskClientMutationId(payload);
    const queueOfflineCreate = () => {
      const queued = enqueueOfflineTaskCreate(userId, payloadWithMutationId);
      const optimisticTask = buildOfflineTask(queued);

      setTasks((prev) => upsertTaskList(prev, optimisticTask));
      setCategories((prev) => Array.from(new Set([...prev, optimisticTask.category])));
      setTags((prev) => Array.from(new Set([...prev, ...(optimisticTask.tags ?? [])])));
      setPendingOfflineTaskCount((prev) => prev + 1);
      return optimisticTask;
    };

    try {
      if (!token) return queueOfflineCreate();

      const created = await apiPost<Task>('/api/tasks', payloadWithMutationId, token);
      tasksMutationVersionRef.current += 1;
      taxonomyMutationVersionRef.current += 1;
      setTasks((prev) => upsertTaskList(prev, created));
      setCategories((prev) => Array.from(new Set([...prev, created.category])));
      setTags((prev) => Array.from(new Set([...prev, ...(created.tags ?? [])])));
      saveTaskCache(userId, upsertTaskList(loadTaskCache(userId), created));
      return created;
    } catch (error) {
      if (isOfflineRequestError(error)) return queueOfflineCreate();
      throw error;
    }
  }, [token, userId]);

  const updateTask = useCallback(async (
    id: string,
    payload: Partial<{
      title: string;
      description: string;
      dueDate: string | null;
      endDate: string | null;
      priority: Priority;
      category: string;
      tags: string[];
      suppressHolidayNotifications: boolean;
      overdueReminderIntensity: TaskOverdueReminderIntensity;
      alarmEnabled: boolean;
      mutedUntil: string | null;
      noTimeReminderMinutes: number;
      status: Status;
    }>,
  ) => {
    if (!userId) throw new Error('Não autenticado');

    const queueId = getQueueIdFromOfflineTaskId(id);
    if (queueId) {
      updateOfflineTaskCreate(queueId, payload as Partial<TaskCreatePayload>);
      const updatedOfflineTask = findOfflineTask(queueId, userId);
      setTasks((prev) => prev.map((task) => (task.id === id ? updatedOfflineTask : task)));
      setCategories((prev) => Array.from(new Set([...prev, updatedOfflineTask.category])));
      setTags((prev) => Array.from(new Set([...prev, ...(updatedOfflineTask.tags ?? [])])));
      return updatedOfflineTask;
    }

    if (!token) throw new Error('Não autenticado');

    const updated = await apiPut<Task>(`/api/tasks/${id}`, payload, token);
    tasksMutationVersionRef.current += 1;
    taxonomyMutationVersionRef.current += 1;
    setTasks((prev) => prev.map((task) => (task.id === id ? updated : task)));
    setCategories((prev) => Array.from(new Set([...prev, updated.category])));
    setTags((prev) => Array.from(new Set([...prev, ...(updated.tags ?? [])])));
    saveTaskCache(userId, loadTaskCache(userId).map((task) => (task.id === id ? updated : task)));
    return updated;
  }, [token, userId]);

  const deleteTask = useCallback(async (id: string) => {
    const queueId = getQueueIdFromOfflineTaskId(id);
    if (queueId) {
      removeOfflineTaskCreate(queueId);
      setPendingOfflineTaskCount((prev) => Math.max(0, prev - 1));
      setTasks((prev) => prev.filter((task) => task.id !== id));
      return;
    }

    if (!token) throw new Error('Não autenticado');

    let snapshot: Task[] = [];
    tasksMutationVersionRef.current += 1;
    setTasks((prev) => {
      snapshot = prev;
      return prev.filter((task) => task.id !== id);
    });

    try {
      await apiDelete(`/api/tasks/${id}`, token);
      if (userId) saveTaskCache(userId, loadTaskCache(userId).filter((task) => task.id !== id));
    } catch (error) {
      setTasks(snapshot);
      throw error;
    }
  }, [token, userId]);

  const toggleStatus = useCallback(async (task: Task) => {
    if (!token || !userId) throw new Error('NÃ£o autenticado');

    if (task.status === 'draft' || task.status === 'inactive') {
      throw new Error(
        task.status === 'draft'
          ? 'Rascunhos precisam ser adicionados como lembrete antes de serem concluídos.'
          : 'Ative o lembrete antes de marcá-lo como concluído.',
      );
    }

    if (task.syncStatus === 'pending') {
      throw new Error('Aguarde a sincronização deste lembrete.');
    }

    const newStatus: Status = task.status === 'pending' || task.status === 'overdue' ? 'completed' : 'pending';

    tasksMutationVersionRef.current += 1;
    setTasks((prev) =>
      prev.map((currentTask) => (
        currentTask.id === task.id
          ? { ...currentTask, status: newStatus }
          : currentTask
      )),
    );
    updateCachedTaskStatus(userId, task.id, newStatus);

    try {
      const updated = await apiPut<Task>(
        `/api/tasks/${task.id}`,
        { status: newStatus },
        token,
      );
      setTasks((prev) =>
        prev.map((currentTask) => (currentTask.id === task.id ? updated : currentTask)),
      );
      upsertCachedTask(userId, updated);
      return { task: updated, newStatus };
    } catch {
      setTasks((prev) =>
        prev.map((currentTask) => (
          currentTask.id === task.id
            ? { ...currentTask, status: task.status }
            : currentTask
        )),
      );
      upsertCachedTask(userId, task);
      throw new Error('Falha ao atualizar o status');
    }
  }, [token, userId]);

  const createCategory = useCallback(async (name: string) => {
    if (!token) throw new Error('Não autenticado');

    const created = await apiPost<{ category: string }>('/api/tasks/categories', { name }, token);
    taxonomyMutationVersionRef.current += 1;
    setCategories((prev) => Array.from(new Set([...prev, created.category])));
    return created.category;
  }, [token]);

  const createTag = useCallback(async (name: string) => {
    if (!token) throw new Error('Não autenticado');

    const created = await apiPost<{ tag: string }>('/api/tasks/tags', { name }, token);
    taxonomyMutationVersionRef.current += 1;
    setTags((prev) => Array.from(new Set([...prev, created.tag])));
    return created.tag;
  }, [token]);

  const deleteCategory = useCallback(async (name: string) => {
    if (!token) throw new Error('Não autenticado');

    const normalized = name.trim();
    if (!normalized) return;

    await apiDelete(`/api/tasks/categories?name=${encodeURIComponent(normalized)}`, token);
    taxonomyMutationVersionRef.current += 1;
    await refreshTasksAndTaxonomy(token, userId);
  }, [refreshTasksAndTaxonomy, token, userId]);

  const deleteTag = useCallback(async (name: string) => {
    if (!token) throw new Error('Não autenticado');

    const normalized = name.trim();
    if (!normalized) return;

    await apiDelete(`/api/tasks/tags?name=${encodeURIComponent(normalized)}`, token);
    taxonomyMutationVersionRef.current += 1;
    await refreshTasksAndTaxonomy(token, userId);
  }, [refreshTasksAndTaxonomy, token, userId]);

  const clearTasks = useCallback(() => {
    setTasks([]);
  }, []);

  return {
    tasks,
    categories,
    tags,
    createTask,
    updateTask,
    deleteTask,
    toggleStatus,
    createCategory,
    createTag,
    deleteCategory,
    deleteTag,
    refreshTasks,
    refreshTaxonomy,
    clearTasks,
    pendingOfflineTaskCount,
    isSyncingOfflineTasks,
    syncOfflineTasks,
  };
}
