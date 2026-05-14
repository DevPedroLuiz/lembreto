import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import type { Note, NoteMode, Priority } from '../types';

type NotePayload = {
  title: string;
  content: string;
  priority: Priority;
  category: string;
  tags: string[];
  mode: NoteMode;
  taskId: string | null;
};

export function useNotes(token: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);
  const mutationVersionRef = useRef(0);

  const refreshNotes = useCallback(async (requestToken = token) => {
    if (!requestToken) {
      setNotes([]);
      return;
    }

    const startedAtMutationVersion = mutationVersionRef.current;
    const data = await apiGet<Note[]>('/api/tasks/notes', requestToken);
    setNotes((current) => (
      mutationVersionRef.current === startedAtMutationVersion
        ? Array.isArray(data) ? data : []
        : current
    ));
  }, [token]);

  useEffect(() => {
    if (!token) {
      setNotes([]);
      return;
    }

    refreshNotes(token).catch(() => {
      setNotes([]);
    });
  }, [refreshNotes, token]);

  const createNote = useCallback(async (payload: NotePayload) => {
    if (!token) throw new Error('Não autenticado');

    const created = await apiPost<Note>('/api/tasks/notes', payload, token);
    mutationVersionRef.current += 1;
    setNotes((prev) => [created, ...prev]);
    return created;
  }, [token]);

  const updateNote = useCallback(async (
    id: string,
    payload: Partial<NotePayload>,
  ) => {
    if (!token) throw new Error('Não autenticado');

    const updated = await apiPut<Note>(`/api/tasks/notes/${id}`, payload, token);
    mutationVersionRef.current += 1;
    setNotes((prev) => prev.map((note) => (note.id === id ? updated : note)));
    return updated;
  }, [token]);

  const deleteNote = useCallback(async (id: string) => {
    if (!token) throw new Error('Não autenticado');

    let snapshot: Note[] = [];
    setNotes((prev) => {
      snapshot = prev;
      return prev.filter((note) => note.id !== id);
    });

    try {
      await apiDelete(`/api/tasks/notes/${id}`, token);
      mutationVersionRef.current += 1;
    } catch (error) {
      setNotes(snapshot);
      throw error;
    }
  }, [token]);

  const clearNotes = useCallback(() => {
    setNotes([]);
  }, []);

  const notesByTask = useMemo(() => {
    const map = new Map<string, Note[]>();

    for (const note of notes) {
      if (!note.taskId) continue;
      const current = map.get(note.taskId) ?? [];
      current.push(note);
      map.set(note.taskId, current);
    }

    for (const taskNotes of map.values()) {
      taskNotes.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    }

    return map;
  }, [notes]);

  return {
    notes,
    notesByTask,
    createNote,
    updateNote,
    deleteNote,
    refreshNotes,
    clearNotes,
  };
}
