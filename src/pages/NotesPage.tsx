import React from 'react';
import { NotebookPen, Plus, Search, StickyNote, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { FilterTag } from '../components/FilterTag';
import { NoteCard } from '../components/NoteCard';
import type { Note, Task } from '../types';

type NoteModeFilter = 'all' | 'fixed' | 'temporary';
type NotesView = 'notes' | 'trash';

interface NotesPageProps {
  notes: Note[];
  trashedNotes: Note[];
  tasks: Task[];
  categories: string[];
  onNewNote: () => void;
  onEditNote: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
  onRestoreNote: (note: Note) => void;
}

export function NotesPage({
  notes,
  trashedNotes,
  tasks,
  categories,
  onNewNote,
  onEditNote,
  onDeleteNote,
  onRestoreNote,
}: NotesPageProps) {
  const [search, setSearch] = React.useState('');
  const [modeFilter, setModeFilter] = React.useState<NoteModeFilter>('all');
  const [categoryFilter, setCategoryFilter] = React.useState('Todas');
  const [activeView, setActiveView] = React.useState<NotesView>('notes');

  const tasksById = React.useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of tasks) {
      map.set(task.id, task);
    }
    return map;
  }, [tasks]);

  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
  const filteredNotes = React.useMemo(
    () => notes.filter((note) => {
      const haystack = [
        note.title,
        note.content,
        note.category,
        ...note.tags,
        note.taskId ? tasksById.get(note.taskId)?.title ?? '' : '',
      ]
        .join(' ')
        .toLocaleLowerCase('pt-BR');

      const matchesSearch = haystack.includes(normalizedSearch);
      const matchesMode = modeFilter === 'all' || note.mode === modeFilter;
      const matchesCategory = categoryFilter === 'Todas' || note.category === categoryFilter;
      return matchesSearch && matchesMode && matchesCategory;
    }),
    [categoryFilter, modeFilter, normalizedSearch, notes, tasksById],
  );

  const fixedCount = notes.filter((note) => note.mode === 'fixed').length;
  const temporaryCount = notes.filter((note) => note.mode === 'temporary').length;
  const isTrashView = activeView === 'trash';

  return (
    <motion.div
      key="notes"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <section className="surface-panel p-5 md:p-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="section-eyebrow">
                <NotebookPen size={14} />
                Caderno pessoal
              </span>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                Capture contexto e mantenha seus lembretes bem acompanhados.
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                Use notas para guardar observações, ideias, links e pontos de apoio. Quando fizer sentido, vincule tudo a um lembrete já existente.
              </p>
            </div>

            <button
              type="button"
              data-testid="new-note-button"
              onClick={onNewNote}
              className="action-primary min-h-[52px] whitespace-nowrap px-5"
            >
              <Plus size={18} />
              Nova nota
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="surface-soft p-4">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total de notas</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">{notes.length}</p>
            </div>
            <div className="surface-soft p-4">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Notas fixas</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">{fixedCount}</p>
            </div>
            <div className="surface-soft p-4">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Notas temporárias</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">{temporaryCount}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              data-testid="notes-view-active"
              onClick={() => setActiveView('notes')}
              aria-pressed={activeView === 'notes'}
              className={[
                'flex min-h-[72px] items-center justify-between rounded-2xl border px-4 py-3 text-left transition-all',
                activeView === 'notes'
                  ? 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-white'
                  : 'border-slate-200 bg-white/80 text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300',
              ].join(' ')}
            >
              <span>
                <span className="block text-sm font-semibold">Notas</span>
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Caderno ativo</span>
              </span>
              <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.08] dark:text-slate-200">
                {notes.length}
              </span>
            </button>
            <button
              type="button"
              data-testid="notes-view-trash"
              onClick={() => setActiveView('trash')}
              aria-pressed={activeView === 'trash'}
              className={[
                'flex min-h-[72px] items-center justify-between rounded-2xl border px-4 py-3 text-left transition-all',
                activeView === 'trash'
                  ? 'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-white'
                  : 'border-slate-200 bg-white/80 text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300',
              ].join(' ')}
            >
              <span className="flex items-center gap-3">
                <Trash2 size={18} />
                <span>
                  <span className="block text-sm font-semibold">Lixeira</span>
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Notas excluídas por 3 dias</span>
                </span>
              </span>
              <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.08] dark:text-slate-200">
                {trashedNotes.length}
              </span>
            </button>
          </div>

          {!isTrashView && (
          <div className="surface-soft p-4">
            <div className="relative">
              <Search className="field-icon" size={18} />
              <input
                type="text"
                data-testid="notes-search-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar notas por título, conteúdo, tag ou lembrete vinculado"
                className="field-control field-control-with-icon"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <FilterTag
                active={modeFilter === 'all'}
                onClick={() => setModeFilter('all')}
                label="Todas"
                count={notes.length}
              />
              <FilterTag
                active={modeFilter === 'fixed'}
                onClick={() => setModeFilter('fixed')}
                label="Fixas"
                count={fixedCount}
              />
              <FilterTag
                active={modeFilter === 'temporary'}
                onClick={() => setModeFilter('temporary')}
                label="Temporárias"
                count={temporaryCount}
              />
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              <FilterTag
                active={categoryFilter === 'Todas'}
                onClick={() => setCategoryFilter('Todas')}
                label="Todas as categorias"
              />
              {categories.map((category) => (
                <FilterTag
                  key={category}
                  active={categoryFilter === category}
                  onClick={() => setCategoryFilter(category)}
                  label={category}
                />
              ))}
            </div>
          </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        {isTrashView ? (
          trashedNotes.length > 0 ? (
            trashedNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                linkedTask={note.taskId ? tasksById.get(note.taskId) ?? null : null}
                onEdit={onEditNote}
                onDelete={onDeleteNote}
                onRestore={onRestoreNote}
                showDeletedMeta
              />
            ))
          ) : (
            <div className="surface-panel rounded-[28px] border border-dashed border-slate-200 bg-slate-50/70 px-6 py-16 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <Trash2 size={34} className="mx-auto mb-4 text-slate-400" />
              <h4 className="text-lg font-semibold text-slate-900 dark:text-white">Lixeira vazia</h4>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Notas excluídas ficam aqui por 3 dias antes da remoção permanente.
              </p>
            </div>
          )
        ) : filteredNotes.length > 0 ? (
          filteredNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              linkedTask={note.taskId ? tasksById.get(note.taskId) ?? null : null}
              onEdit={onEditNote}
              onDelete={onDeleteNote}
            />
          ))
        ) : (
          <div className="surface-panel rounded-[28px] border border-dashed border-slate-200 bg-slate-50/70 px-6 py-16 text-center dark:border-white/10 dark:bg-white/[0.03]">
            <StickyNote size={34} className="mx-auto mb-4 text-slate-400" />
            <h4 className="text-lg font-semibold text-slate-900 dark:text-white">Nenhuma nota encontrada</h4>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Comece com uma nota fixa para referência rápida ou uma nota temporária vinculada a um lembrete.
            </p>
            <button onClick={onNewNote} className="action-primary mt-6">
              Criar primeira nota
            </button>
          </div>
        )}
      </section>
    </motion.div>
  );
}
