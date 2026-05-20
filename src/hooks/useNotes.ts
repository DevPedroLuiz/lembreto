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
  expiresAt: string | null;
  taskId: string | null;
  restore?: boolean;
};

export function useNotes(token: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [trashedNotes, setTrashedNotes] = useState<Note[]>([]);
  const mutationVersionRef = useRef(0);

  const refreshNotes = useCallback(async (requestToken = token) => {
    if (!requestToken) {
      setNotes([]);
      setTrashedNotes([]);
      return;
    }

    const startedAtMutationVersion = mutationVersionRef.current;
    const [activeData, trashData] = await Promise.all([
      apiGet<Note[]>('/api/tasks/notes', requestToken),
      apiGet<Note[]>('/api/tasks/notes?trash=1', requestToken),
    ]);
    if (mutationVersionRef.current === startedAtMutationVersion) {
      setNotes(Array.isArray(activeData) ? activeData : []);
      setTrashedNotes(Array.isArray(trashData) ? trashData : []);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setNotes([]);
      setTrashedNotes([]);
      return;
    }

    refreshNotes(token).catch(() => {
      setNotes([]);
      setTrashedNotes([]);
    });
  }, [refreshNotes, token]);

  const createNote = useCallback(async (payload: NotePayload) => {
    if (!token) throw new Error('Não autenticado');

    const created = await apiPost<Note>('/api/tasks/notes', payload, token);
    mutationVersionRef.current += 1;
    setNotes((prev) => [created, ...prev]);
    setTrashedNotes((prev) => prev.filter((note) => note.id !== created.id));
    return created;
  }, [token]);

  const updateNote = useCallback(async (
    id: string,
    payload: Partial<NotePayload>,
  ) => {
    if (!token) throw new Error('Não autenticado');

    const updated = await apiPut<Note>(`/api/tasks/notes/${id}`, payload, token);
    mutationVersionRef.current += 1;
    if (updated.deletedAt) {
      setNotes((prev) => prev.filter((note) => note.id !== id));
      setTrashedNotes((prev) => [updated, ...prev.filter((note) => note.id !== id)]);
    } else {
      setNotes((prev) => [updated, ...prev.filter((note) => note.id !== id)]);
      setTrashedNotes((prev) => prev.filter((note) => note.id !== id));
    }
    return updated;
  }, [token]);

  const deleteNote = useCallback(async (id: string) => {
    if (!token) throw new Error('Não autenticado');

    let snapshot: Note[] = [];
    let trashSnapshot: Note[] = [];
    let deletedNote: Note | null = null;
    setNotes((prev) => {
      snapshot = prev;
      deletedNote = prev.find((note) => note.id === id) ?? null;
      return prev.filter((note) => note.id !== id);
    });
    setTrashedNotes((prev) => {
      trashSnapshot = prev;
      return deletedNote
        ? [
          {
            ...deletedNote,
            deletedAt: new Date().toISOString(),
            deleteAfter: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
            deletionReason: 'manual',
          },
          ...prev.filter((note) => note.id !== id),
        ]
        : prev;
    });

    try {
      await apiDelete(`/api/tasks/notes/${id}`, token);
      mutationVersionRef.current += 1;
    } catch (error) {
      setNotes(snapshot);
      setTrashedNotes(trashSnapshot);
      throw error;
    }
  }, [token]);

  const clearNotes = useCallback(() => {
    setNotes([]);
    setTrashedNotes([]);
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
    trashedNotes,
    notesByTask,
    createNote,
    updateNote,
    deleteNote,
    refreshNotes,
    clearNotes,
  };
}
