import { useState, useEffect, useCallback } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import type { Priority, Status, Task, TaskTaxonomy } from '../types';

type TaskPayload = {
  title: string;
  description: string;
  dueDate: string;
  priority: Priority;
  category: string;
  tags: string[];
  suppressHolidayNotifications: boolean;
};

export function useTasks(token: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);

  const refreshTasks = useCallback(async (requestToken = token) => {
    if (!requestToken) {
      setTasks([]);
      return;
    }

    const data = await apiGet<Task[]>('/api/tasks', requestToken);
    setTasks(Array.isArray(data) ? data : []);
  }, [token]);

  const refreshTaxonomy = useCallback(async (requestToken = token) => {
    if (!requestToken) {
      setCategories([]);
      setTags([]);
      return;
    }

    const data = await apiGet<TaskTaxonomy>('/api/tasks/metadata', requestToken);
    setCategories(Array.isArray(data.categories) ? data.categories : []);
    setTags(Array.isArray(data.tags) ? data.tags : []);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setTasks([]);
      setCategories([]);
      setTags([]);
      return;
    }

    Promise.all([
      apiGet<Task[]>('/api/tasks', token),
      apiGet<TaskTaxonomy>('/api/tasks/metadata', token),
    ])
      .then(([taskData, taxonomy]) => {
        setTasks(Array.isArray(taskData) ? taskData : []);
        setCategories(Array.isArray(taxonomy.categories) ? taxonomy.categories : []);
        setTags(Array.isArray(taxonomy.tags) ? taxonomy.tags : []);
      })
      .catch(() => {
        setTasks([]);
        setCategories([]);
        setTags([]);
      });
  }, [token]);

  const createTask = useCallback(async (payload: TaskPayload) => {
    if (!token) throw new Error('Não autenticado');

    const created = await apiPost<Task>('/api/tasks', payload, token);
    setTasks((prev) => [created, ...prev]);
    setCategories((prev) => Array.from(new Set([...prev, created.category])));
    setTags((prev) => Array.from(new Set([...prev, ...(created.tags ?? [])])));
    return created;
  }, [token]);

  const updateTask = useCallback(async (
    id: string,
    payload: Partial<{
      title: string;
      description: string;
      dueDate: string | null;
      priority: Priority;
      category: string;
      tags: string[];
      suppressHolidayNotifications: boolean;
      status: Status;
    }>,
  ) => {
    if (!token) throw new Error('Não autenticado');

    const updated = await apiPut<Task>(`/api/tasks/${id}`, payload, token);
    setTasks((prev) => prev.map((task) => (task.id === id ? updated : task)));
    setCategories((prev) => Array.from(new Set([...prev, updated.category])));
    setTags((prev) => Array.from(new Set([...prev, ...(updated.tags ?? [])])));
    return updated;
  }, [token]);

  const deleteTask = useCallback(async (id: string) => {
    if (!token) throw new Error('Não autenticado');

    let snapshot: Task[] = [];
    setTasks((prev) => {
      snapshot = prev;
      return prev.filter((task) => task.id !== id);
    });

    try {
      await apiDelete(`/api/tasks/${id}`, token);
    } catch (error) {
      setTasks(snapshot);
      throw error;
    }
  }, [token]);

  const toggleStatus = useCallback(async (task: Task) => {
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
    if (!token) throw new Error('Não autenticado');

    const created = await apiPost<{ category: string }>('/api/tasks/categories', { name }, token);
    setCategories((prev) => Array.from(new Set([...prev, created.category])));
    return created.category;
  }, [token]);

  const createTag = useCallback(async (name: string) => {
    if (!token) throw new Error('Não autenticado');

    const created = await apiPost<{ tag: string }>('/api/tasks/tags', { name }, token);
    setTags((prev) => Array.from(new Set([...prev, created.tag])));
    return created.tag;
  }, [token]);

  const deleteCategory = useCallback(async (name: string) => {
    if (!token) throw new Error('Não autenticado');

    const normalized = name.trim();
    if (!normalized) return;

    await apiDelete(`/api/tasks/categories?name=${encodeURIComponent(normalized)}`, token);
    await Promise.all([refreshTasks(token), refreshTaxonomy(token)]);
  }, [refreshTasks, refreshTaxonomy, token]);

  const deleteTag = useCallback(async (name: string) => {
    if (!token) throw new Error('Não autenticado');

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
  };
}
