import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client';
import type { Task, Priority, Status } from '../types';

export function useTasks(token: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!token) {
      setTasks([]);
      return;
    }

    apiGet<Task[]>('/api/tasks', token)
      .then((data) => {
        if (Array.isArray(data)) setTasks(data);
      })
      .catch(() => setTasks([]));
  }, [token]);

  const createTask = useCallback(async (payload: {
    title: string;
    description: string;
    dueDate: string;
    priority: Priority;
    category: string;
  }) => {
    if (!token) throw new Error('Não autenticado');
    const created = await apiPost<Task>('/api/tasks', payload, token);
    setTasks((prev) => [created, ...prev]);
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
      status: Status;
    }>
  ) => {
    if (!token) throw new Error('Não autenticado');
    const updated = await apiPut<Task>(`/api/tasks/${id}`, payload, token);
    setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    return updated;
  }, [token]);

  const deleteTask = useCallback(async (id: string) => {
    if (!token) throw new Error('Não autenticado');

    let snapshot: Task[] = [];
    setTasks((prev) => {
      snapshot = prev;
      return prev.filter((t) => t.id !== id);
    });

    try {
      await apiDelete(`/api/tasks/${id}`, token);
    } catch (err) {
      setTasks(snapshot);
      throw err;
    }
  }, [token]);

  const toggleStatus = useCallback(async (task: Task) => {
    const newStatus: Status = task.status === 'pending' ? 'completed' : 'pending';

    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t))
    );

    try {
      const updated = await apiPut<Task>(
        `/api/tasks/${task.id}`,
        { status: newStatus },
        token!
      );
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? updated : t))
      );
      return { task: updated, newStatus };
    } catch {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: task.status } : t
        )
      );
      throw new Error('Falha ao atualizar o status');
    }
  }, [token]);

  const clearTasks = useCallback(() => setTasks([]), []);

  return {
    tasks,
    createTask,
    updateTask,
    deleteTask,
    toggleStatus,
    clearTasks,
  };
}
