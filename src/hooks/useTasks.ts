import { useState, useEffect, useCallback } from 'react';
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

  const syncOfflineTasks = useCallback(async (requestToken = token, requestUserId = userId) => {
    if (!requestToken || !requestUserId) return 0;

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
        const [serverTasks, taxonomy] = await Promise.all([
          apiGet<Task[]>('/api/tasks', requestToken).catch(() => null),
          apiGet<TaskTaxonomy>('/api/tasks/metadata', requestToken).catch(() => null),
        ]);

        if (Array.isArray(serverTasks)) {
          saveTaskCache(requestUserId, serverTasks);
          setTasks(mergeTasksWithOfflineCreates(serverTasks, remainingCreates));
        }

        if (taxonomy) {
          const syncedTaxonomy = {
            categories: Array.isArray(taxonomy.categories) ? taxonomy.categories : [],
            tags: Array.isArray(taxonomy.tags) ? taxonomy.tags : [],
          };
          saveTaskTaxonomyCache(requestUserId, syncedTaxonomy);
          const mergedTaxonomy = mergeTaxonomyWithOfflineCreates(syncedTaxonomy, remainingCreates);
          setCategories(mergedTaxonomy.categories);
          setTags(mergedTaxonomy.tags);
        }
      }

      return syncedCount;
    } finally {
      setIsSyncingOfflineTasks(false);
    }
  }, [token, userId]);

  const refreshTasks = useCallback(async (requestToken = token) => {
    if (!userId) {
      setTasks([]);
      return;
    }

    if (!requestToken) {
      setTasks(mergeTasksWithOfflineCreates(loadTaskCache(userId), loadOfflineTaskCreates(userId)));
      return;
    }

    const data = await apiGet<Task[]>('/api/tasks', requestToken);
    const syncedTasks = Array.isArray(data) ? data : [];
    saveTaskCache(userId, syncedTasks);
    setTasks(mergeTasksWithOfflineCreates(syncedTasks, loadOfflineTaskCreates(userId)));
  }, [token, userId]);

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

    const data = await apiGet<TaskTaxonomy>('/api/tasks/metadata', requestToken);
    const taxonomy = {
      categories: Array.isArray(data.categories) ? data.categories : [],
      tags: Array.isArray(data.tags) ? data.tags : [],
    };
    saveTaskTaxonomyCache(userId, taxonomy);

    const mergedTaxonomy = mergeTaxonomyWithOfflineCreates(taxonomy, loadOfflineTaskCreates(userId));
    setCategories(mergedTaxonomy.categories);
    setTags(mergedTaxonomy.tags);
  }, [token, userId]);

  useEffect(() => {
    if (!userId) {
      applyCachedState(null);
      return;
    }

    applyCachedState(userId);

    if (!token) return;

    void syncOfflineTasks(token, userId).catch(() => {
      // Keep queued reminders locally when sync is not possible.
    });

    Promise.all([
      apiGet<Task[]>('/api/tasks', token),
      apiGet<TaskTaxonomy>('/api/tasks/metadata', token),
    ])
      .then(([taskData, taxonomy]) => {
        const syncedTasks = Array.isArray(taskData) ? taskData : [];
        const syncedTaxonomy = {
          categories: Array.isArray(taxonomy.categories) ? taxonomy.categories : [],
          tags: Array.isArray(taxonomy.tags) ? taxonomy.tags : [],
        };
        const offlineCreates = loadOfflineTaskCreates(userId);

        saveTaskCache(userId, syncedTasks);
        saveTaskTaxonomyCache(userId, syncedTaxonomy);
        setTasks(mergeTasksWithOfflineCreates(syncedTasks, offlineCreates));

        const mergedTaxonomy = mergeTaxonomyWithOfflineCreates(syncedTaxonomy, offlineCreates);
        setCategories(mergedTaxonomy.categories);
        setTags(mergedTaxonomy.tags);
        setPendingOfflineTaskCount(offlineCreates.length);
      })
      .catch(() => {
        applyCachedState(userId);
      });
  }, [applyCachedState, syncOfflineTasks, token, userId]);

  useEffect(() => {
    if (!token || !userId) return undefined;

    const sync = () => {
      if (document.visibilityState === 'hidden') return;
      void syncOfflineTasks(token, userId).catch(() => {
        // Best effort sync when the browser reports connectivity again.
      });
    };

    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);

    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
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
    if (task.syncStatus === 'pending') {
      throw new Error('Aguarde a sincronizacao deste lembrete.');
    }

    const newStatus: Status = task.status === 'pending' ? 'completed' : 'pending';

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
    setCategories((prev) => Array.from(new Set([...prev, created.category])));
    return created.category;
  }, [token]);

  const createTag = useCallback(async (name: string) => {
    if (!token) throw new Error('Nao autenticado');

    const created = await apiPost<{ tag: string }>('/api/tasks/tags', { name }, token);
    setTags((prev) => Array.from(new Set([...prev, created.tag])));
    return created.tag;
  }, [token]);

  const deleteCategory = useCallback(async (name: string) => {
    if (!token) throw new Error('Nao autenticado');

    const normalized = name.trim();
    if (!normalized) return;

    await apiDelete(`/api/tasks/categories?name=${encodeURIComponent(normalized)}`, token);
    await Promise.all([refreshTasks(token), refreshTaxonomy(token)]);
  }, [refreshTasks, refreshTaxonomy, token]);

  const deleteTag = useCallback(async (name: string) => {
    if (!token) throw new Error('Nao autenticado');

    const normalized = name.trim();
    if (!normalized) return;

    await apiDelete(`/api/tasks/tags?name=${encodeURIComponent(normalized)}`, token);
    await Promise.all([refreshTasks(token), refreshTaxonomy(token)]);
  }, [refreshTasks, refreshTaxonomy, token]);

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
