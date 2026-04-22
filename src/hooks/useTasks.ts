// src/hooks/useTasks.ts
// Encapsulates all task state and CRUD logic

import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client';
import type { Task, Priority, Status } from '../types';

export function useTasks(token: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);

  // ── Fetch on token change ─────────────────────────────────────────────────
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

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const createTask = async (payload: {
    title: string;
    description: string;
    dueDate: string;
    priority: Priority;
    category: string;
  }) => {
    if (!token) throw new Error('Não autenticado');
    const created = await apiPost<Task>('/api/tasks', payload, token);
    setTasks((prev) => [...prev, created]);
    return created;
  };

  const updateTask = async (
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
  };

  const deleteTask = async (id: string) => {
    if (!token) throw new Error('Não autenticado');
    // Optimistic update
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      await apiDelete(`/api/tasks/${id}`, token);
    } catch (err) {
      // Rollback handled by caller if needed
      throw err;
    }
  };

  const toggleStatus = async (task: Task) => {
    const newStatus: Status =
      task.status === 'pending' ? 'completed' : 'pending';
    // Optimistic update
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
      // Rollback
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: task.status } : t
        )
      );
      throw new Error('Falha ao atualizar status');
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const clearTasks = () => setTasks([]);

  return {
    tasks,
    createTask,
    updateTask,
    deleteTask,
    toggleStatus,
    clearTasks,
  };
}
