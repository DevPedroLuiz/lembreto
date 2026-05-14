import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import {
  buildOfflineTask,
  enqueueOfflineTaskCreate,
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
import type { Priority, Status, Task, TaskTaxonomy, User } from '../types';

type TaskPayload = TaskCreatePayload;
type InFlightRequest<T> = {
  key: string;
  promise: Promise<T>;
};

const SYNC_REFRESH_DEBOUNCE_MS = 3000;

function normalizeTaxonomy(data: TaskTaxonomy): TaskTaxonomy {
  return {
    categories: Array.isArray(data.categories) ? data.categories : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
}

function findOfflineTask(queueId: string, userId: string): Task {
  const item = loadOfflineTaskCreates(userId).find((current) => current.id === queueId);
  if (!item) throw new Error('Lembrete offline nao encontrado');
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

    const promise = apiGet<Task[]>('/api/tasks', requestToken)
      .then((data) => (Array.isArray(data) ? data : []))
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
      setIsSyncingOfflineTasks(true);

      try {
        for (const item of offlineCreates) {
          try {
            const created = await apiPost<Task>('/api/tasks', item.payload, requestToken);
            removeOfflineTaskCreate(item.id);
            syncedCount += 1;

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
        void syncOfflineTasks(token, userId).catch(() => {
          // Best effort sync when the browser reports connectivity again.
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
  }, [syncOfflineTasks, token, userId]);

  const createTask = useCallback(async (payload: TaskPayload) => {
    if (!userId) throw new Error('Nao autenticado');

    const queueOfflineCreate = () => {
      const queued = enqueueOfflineTaskCreate(userId, payload);
      const optimisticTask = buildOfflineTask(queued);

      setTasks((prev) => [optimisticTask, ...prev]);
      setCategories((prev) => Array.from(new Set([...prev, optimisticTask.category])));
      setTags((prev) => Array.from(new Set([...prev, ...(optimisticTask.tags ?? [])])));
      setPendingOfflineTaskCount((prev) => prev + 1);

      return optimisticTask;
    };

    if (!token) return queueOfflineCreate();

    try {
      const created = await apiPost<Task>('/api/tasks', payload, token);
      tasksMutationVersionRef.current += 1;
      taxonomyMutationVersionRef.current += 1;
      setTasks((prev) => [created, ...prev]);
      setCategories((prev) => Array.from(new Set([...prev, created.category])));
      setTags((prev) => Array.from(new Set([...prev, ...(created.tags ?? [])])));
      saveTaskCache(userId, [created, ...loadTaskCache(userId)]);
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
      alarmEnabled: boolean;
      mutedUntil: string | null;
      noTimeReminderMinutes: number;
      status: Status;
    }>,
  ) => {
    if (!userId) throw new Error('Nao autenticado');

    const queueId = getQueueIdFromOfflineTaskId(id);
    if (queueId) {
      updateOfflineTaskCreate(queueId, payload as Partial<TaskCreatePayload>);
      const updatedOfflineTask = findOfflineTask(queueId, userId);
      setTasks((prev) => prev.map((task) => (task.id === id ? updatedOfflineTask : task)));
      setCategories((prev) => Array.from(new Set([...prev, updatedOfflineTask.category])));
      setTags((prev) => Array.from(new Set([...prev, ...(updatedOfflineTask.tags ?? [])])));
      return updatedOfflineTask;
    }

    if (!token) throw new Error('Nao autenticado');

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

    if (!token) throw new Error('Nao autenticado');

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
    if (task.status === 'draft' || task.status === 'inactive') {
      throw new Error(
        task.status === 'draft'
          ? 'Rascunhos precisam ser adicionados como lembrete antes de serem concluídos.'
          : 'Ative o lembrete antes de marcá-lo como concluído.',
      );
    }

    if (task.syncStatus === 'pending') {
      throw new Error('Aguarde a sincronizacao deste lembrete.');
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

    try {
      const updated = await apiPut<Task>(
        `/api/tasks/${task.id}`,
        { status: newStatus },
        token!,
      );
      setTasks((prev) =>
        prev.map((currentTask) => (currentTask.id === task.id ? updated : currentTask)),
      );
      return { task: updated, newStatus };
    } catch {
      setTasks((prev) =>
        prev.map((currentTask) => (
          currentTask.id === task.id
            ? { ...currentTask, status: task.status }
            : currentTask
        )),
      );
      throw new Error('Falha ao atualizar o status');
    }
  }, [token]);

  const createCategory = useCallback(async (name: string) => {
    if (!token) throw new Error('Nao autenticado');

    const created = await apiPost<{ category: string }>('/api/tasks/categories', { name }, token);
    taxonomyMutationVersionRef.current += 1;
    setCategories((prev) => Array.from(new Set([...prev, created.category])));
    return created.category;
  }, [token]);

  const createTag = useCallback(async (name: string) => {
    if (!token) throw new Error('Nao autenticado');

    const created = await apiPost<{ tag: string }>('/api/tasks/tags', { name }, token);
    taxonomyMutationVersionRef.current += 1;
    setTags((prev) => Array.from(new Set([...prev, created.tag])));
    return created.tag;
  }, [token]);

  const deleteCategory = useCallback(async (name: string) => {
    if (!token) throw new Error('Nao autenticado');

    const normalized = name.trim();
    if (!normalized) return;

    await apiDelete(`/api/tasks/categories?name=${encodeURIComponent(normalized)}`, token);
    taxonomyMutationVersionRef.current += 1;
    await refreshTasksAndTaxonomy(token, userId);
  }, [refreshTasksAndTaxonomy, token, userId]);

  const deleteTag = useCallback(async (name: string) => {
    if (!token) throw new Error('Nao autenticado');

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
