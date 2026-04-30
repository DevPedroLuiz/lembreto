import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Clock3,
  FileText,
  Flag,
  Link2,
  Loader2,
  Pin,
  Plus,
  Tag,
  X,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { useSwipeToClose } from '../hooks/useSwipeToClose';
import type { Note, NoteMode, Priority, Task } from '../types';

interface NoteDrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  editingNote: Note | null;
  isSubmitting?: boolean;
  title: string;
  setTitle: (value: string) => void;
  content: string;
  setContent: (value: string) => void;
  priority: Priority;
  setPriority: (value: Priority) => void;
  category: string;
  setCategory: (value: string) => void;
  categoryOptions: string[];
  tags: string[];
  setTags: (value: string[]) => void;
  tagOptions: string[];
  mode: NoteMode;
  setMode: (value: NoteMode) => void;
  taskId: string | null;
  setTaskId: (value: string | null) => void;
  tasks: Task[];
  lockedTask?: Task | null;
}

function normalizeTaxonomyValue(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function NoteDrawer({
  open,
  onClose,
  onSubmit,
  editingNote,
  isSubmitting = false,
  title,
  setTitle,
  content,
  setContent,
  priority,
  setPriority,
  category,
  setCategory,
  categoryOptions,
  tags,
  setTags,
  tagOptions,
  mode,
  setMode,
  taskId,
  setTaskId,
  tasks,
  lockedTask = null,
}: NoteDrawerProps) {
  const [tagDraft, setTagDraft] = React.useState('');
  const [tagFeedback, setTagFeedback] = React.useState('');
  const swipe = useSwipeToClose({
    enabled: open,
    direction: 'down',
    onClose,
    locked: isSubmitting,
  });

  React.useEffect(() => {
    if (!open) return;
    setTagDraft('');
    setTagFeedback('');
  }, [open, editingNote]);

  const availableTagSuggestions = React.useMemo(
    () => tagOptions.filter((item) => !tags.includes(item)),
    [tagOptions, tags],
  );
  const availableTasks = React.useMemo(
    () => tasks.filter((task) => task.status === 'pending' || task.id === taskId),
    [taskId, tasks],
  );

  const addTag = React.useCallback((value: string) => {
    const normalized = normalizeTaxonomyValue(value);
    if (!normalized || tags.includes(normalized)) return;
    setTags([...tags, normalized]);
    setTagDraft('');
    setTagFeedback('');
  }, [setTags, tags]);

  const removeTag = React.useCallback((value: string) => {
    setTags(tags.filter((item) => item !== value));
    setTagFeedback('');
  }, [setTags, tags]);

  const handleAddExistingTag = React.useCallback(() => {
    const normalized = normalizeTaxonomyValue(tagDraft);
    if (!normalized) return;

    if (!tagOptions.includes(normalized)) {
      setTagFeedback('Cadastre novas tags em Configurações antes de usá-las nas notas.');
      return;
    }

    addTag(normalized);
  }, [addTag, tagDraft, tagOptions]);

  const isEditing = Boolean(editingNote);
  const titleCount = title.trim().length;
  const linkedTask = lockedTask ?? availableTasks.find((task) => task.id === taskId) ?? null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (!isSubmitting) onClose();
            }}
            className="fixed inset-0 z-[120] bg-slate-950/60 backdrop-blur-sm"
          />

          <div className="fixed inset-0 z-[121] flex items-end justify-center p-2 sm:items-center sm:p-5">
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: swipe.offset, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={swipe.isDragging ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 260 }}
              className="flex max-h-[calc(100dvh-0.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/96 shadow-[0_30px_120px_-34px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94 sm:max-h-[calc(100vh-2.5rem)] sm:rounded-[34px]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="note-drawer-title"
            >
              {swipe.mobileEnabled && (
                <div
                  className="flex justify-center border-b border-slate-200/70 px-4 py-3 dark:border-white/10"
                  aria-hidden="true"
                  {...swipe.bind}
                >
                  <span className="h-1.5 w-14 rounded-full bg-slate-300/90 dark:bg-slate-700" />
                </div>
              )}

              <div className="border-b border-slate-200/80 bg-gradient-to-br from-blue-700 via-blue-600 to-sky-500 px-4 py-3 text-white dark:border-white/10 sm:px-5 sm:py-5 md:px-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="max-w-2xl">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/80 backdrop-blur-sm">
                      {isEditing ? 'Edição' : 'Anotação'}
                    </span>
                    <h2 id="note-drawer-title" className="mt-2.5 text-[1.55rem] font-semibold leading-tight text-white sm:mt-4 sm:text-2xl md:text-[2rem]">
                      {isEditing ? 'Editar nota' : 'Nova nota'}
                    </h2>
                    <p className="mt-1.5 max-w-2xl text-[12px] leading-5 text-blue-50/88 sm:mt-2 sm:text-sm sm:leading-6">
                      Registre contexto e apoio sem perder a ligação com seus lembretes.
                    </p>
                  </div>

                  <button
                    onClick={onClose}
                    disabled={isSubmitting}
                    aria-label="Fechar formulário de nota"
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white/90 transition-colors hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-50 sm:h-11 sm:w-11"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 sm:mt-5 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:pb-0">
                  <div className="min-w-[110px] rounded-2xl border border-white/15 bg-white/10 px-3 py-2.5 text-white/90 sm:min-w-0 sm:px-4 sm:py-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/60 sm:gap-2 sm:text-[11px] sm:tracking-[0.16em]">
                      <Flag size={13} />
                      Prioridade
                    </div>
                    <p className="mt-1.5 truncate text-[13px] font-semibold sm:mt-2 sm:text-sm">{priority === 'high' ? 'Alta' : priority === 'medium' ? 'Média' : 'Baixa'}</p>
                  </div>
                  <div className="min-w-[110px] rounded-2xl border border-white/15 bg-white/10 px-3 py-2.5 text-white/90 sm:min-w-0 sm:px-4 sm:py-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/60 sm:gap-2 sm:text-[11px] sm:tracking-[0.16em]">
                      <Pin size={13} />
                      Tipo
                    </div>
                    <p className="mt-1.5 truncate text-[13px] font-semibold sm:mt-2 sm:text-sm">{mode === 'fixed' ? 'Fixa' : 'Temporária'}</p>
                  </div>
                  <div className="min-w-[110px] rounded-2xl border border-white/15 bg-white/10 px-3 py-2.5 text-white/90 sm:min-w-0 sm:px-4 sm:py-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/60 sm:gap-2 sm:text-[11px] sm:tracking-[0.16em]">
                      <Link2 size={13} />
                      Vínculo
                    </div>
                    <p className="mt-1.5 truncate text-[13px] font-semibold sm:mt-2 sm:text-sm">{linkedTask ? linkedTask.title : 'Sem vínculo'}</p>
                  </div>
                </div>
              </div>

              <form
                id="note-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSubmit();
                }}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5 md:px-7 md:py-6">
                  <div className="space-y-6">
                  <section className="surface-soft p-4 sm:p-5">
                    <div className="mb-4 flex items-start gap-3">
                      <span className="icon-slot h-10 w-10 rounded-2xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                        <FileText size={18} />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Conteúdo da nota</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Escreva apenas o contexto que ajuda você a agir melhor depois.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <label className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            Título
                          </label>
                          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                            {titleCount}/80
                          </span>
                        </div>
                        <input
                          autoFocus
                          required
                          maxLength={80}
                          type="text"
                          data-testid="note-title-input"
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          placeholder="Ex.: Pontos para a reunião de alinhamento"
                          className="field-control"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Conteúdo
                        </label>
                        <textarea
                          data-testid="note-content-input"
                          value={content}
                          onChange={(event) => setContent(event.target.value)}
                          placeholder="Escreva observações, ideias, contexto ou próximos passos."
                          className="field-control min-h-[120px] resize-none sm:min-h-[180px]"
                        />
                      </div>
                    </div>
                  </section>

                  <section className="surface-soft p-4 sm:p-5">
                    <div className="mb-4 flex items-start gap-3">
                      <span className="icon-slot h-10 w-10 rounded-2xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                        <Tag size={18} />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Classificação</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Relacione esta nota com a mesma organização dos seus lembretes.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Prioridade
                        </label>
                        <select
                          value={priority}
                          data-testid="note-priority-select"
                          onChange={(event) => setPriority(event.target.value as Priority)}
                          className="field-control cursor-pointer"
                        >
                          <option value="low">Baixa</option>
                          <option value="medium">Média</option>
                          <option value="high">Alta</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Categoria
                        </label>
                        <select
                          value={category}
                          data-testid="note-category-select"
                          onChange={(event) => setCategory(event.target.value)}
                          className="field-control cursor-pointer"
                        >
                          {categoryOptions.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Tipo da nota
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            data-testid="note-mode-temporary"
                            aria-pressed={mode === 'temporary'}
                            onClick={() => setMode('temporary')}
                            className={cn(
                              'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all',
                              mode === 'temporary'
                                ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]',
                            )}
                          >
                            <Clock3 size={15} />
                            Temporária
                          </button>
                          <button
                            type="button"
                            data-testid="note-mode-fixed"
                            aria-pressed={mode === 'fixed'}
                            onClick={() => setMode('fixed')}
                            className={cn(
                              'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all',
                              mode === 'fixed'
                                ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]',
                            )}
                          >
                            <Pin size={15} />
                            Fixa
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Vincular ao lembrete
                        </label>
                        <select
                          value={linkedTask ? linkedTask.id : taskId ?? ''}
                          disabled={Boolean(lockedTask)}
                          data-testid="note-task-select"
                          onChange={(event) => setTaskId(event.target.value || null)}
                          className="field-control cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          <option value="">Sem vínculo</option>
                          {availableTasks.map((task) => (
                            <option key={task.id} value={task.id}>
                              {task.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Tags
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={tagDraft}
                          list="note-tag-options"
                          onChange={(event) => setTagDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              handleAddExistingTag();
                            }
                          }}
                          placeholder={tagOptions.length > 0 ? 'Selecione uma tag já cadastrada' : 'Cadastre tags em Configurações'}
                          data-testid="note-tag-input"
                          className="field-control"
                        />
                        <datalist id="note-tag-options">
                          {tagOptions.map((item) => (
                            <option key={item} value={item} />
                          ))}
                        </datalist>
                        <button
                          type="button"
                          data-testid="note-tag-add-button"
                          onClick={handleAddExistingTag}
                          disabled={!normalizeTaxonomyValue(tagDraft)}
                          className="action-secondary min-w-[120px] justify-center rounded-xl px-4 py-0 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Plus size={16} />
                          Adicionar
                        </button>
                      </div>

                      {availableTagSuggestions.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {availableTagSuggestions.slice(0, 8).map((item) => (
                            <button
                              key={item}
                              type="button"
                              data-testid={`note-tag-suggestion-${item.toLowerCase().replace(/\s+/g, '-')}`}
                              onClick={() => addTag(item)}
                              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                            >
                              <Tag size={12} />
                              {item}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 flex min-h-[44px] flex-wrap gap-2">
                        {tags.length > 0 ? (
                          tags.map((item) => (
                            <span
                              key={item}
                              data-testid="note-tag-chip"
                              className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300"
                            >
                              <Tag size={12} />
                              {item}
                              <button
                                type="button"
                                onClick={() => removeTag(item)}
                                aria-label={`Remover tag ${item}`}
                                className="text-blue-500 transition-colors hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-100"
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))
                        ) : (
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            Use tags existentes para identificar o tipo da nota com mais rapidez.
                          </p>
                        )}
                      </div>

                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Novas categorias e tags são cadastradas em Configurações.
                      </p>

                      {tagFeedback && (
                        <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                          {tagFeedback}
                        </p>
                      )}
                    </div>
                  </section>
                  </div>
                </div>

                <div className="border-t border-slate-200/80 bg-white/88 px-4 py-3 dark:border-white/10 dark:bg-slate-950/92 sm:px-5 sm:py-4 md:px-7">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={isSubmitting}
                      className="action-ghost justify-center rounded-2xl border border-slate-200/80 px-4 py-3 text-sm dark:border-white/10"
                    >
                      Cancelar
                    </button>

                    <button
                      type="button"
                      data-testid="note-submit-button"
                      onClick={() => void onSubmit()}
                      disabled={isSubmitting}
                      className="action-primary w-full justify-center rounded-2xl py-4 disabled:cursor-wait disabled:opacity-70 sm:min-w-[240px] sm:w-auto"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          {isEditing ? 'Salvando nota...' : 'Criando nota...'}
                        </>
                      ) : isEditing ? (
                        'Salvar nota'
                      ) : (
                        'Adicionar nota'
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}




