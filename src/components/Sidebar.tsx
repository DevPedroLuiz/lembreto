import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarDays,
  ChevronRight,
  FolderPlus,
  LayoutDashboard,
  ListTodo,
  Loader2,
  LogOut,
  NotebookPen,
  Plus,
  Settings,
  Target,
  User as UserIcon,
  X,
} from 'lucide-react';
import { SidebarItem } from './SidebarItem';
import { FilterTag } from './FilterTag';
import { isDefaultCategory, normalizeTaxonomyValue } from '../lib/taxonomy';
import type { Task, User } from '../types';

interface SidebarProps {
  currentUser: User;
  activeTab: 'dashboard' | 'calendar' | 'tasks' | 'notes' | 'notifications';
  setActiveTab: (tab: 'dashboard' | 'calendar' | 'tasks' | 'notes' | 'notifications') => void;
  categories: string[];
  filterCategory: string;
  setFilterCategory: (cat: string) => void;
  pendingTasks: Task[];
  overdueCount: number;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onCreateCategory: (name: string) => Promise<string>;
  onDeleteCategory: (name: string) => Promise<void>;
  onLogout: () => void;
}

export function Sidebar({
  currentUser,
  activeTab,
  setActiveTab,
  categories,
  filterCategory,
  setFilterCategory,
  pendingTasks,
  overdueCount,
  onOpenProfile,
  onOpenSettings,
  onCreateCategory,
  onDeleteCategory,
  onLogout,
}: SidebarProps) {
  const categoryManagerRef = React.useRef<HTMLDivElement | null>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = React.useState(false);
  const [categoryDraft, setCategoryDraft] = React.useState('');
  const [isCreatingCategory, setIsCreatingCategory] = React.useState(false);
  const [deletingCategoryName, setDeletingCategoryName] = React.useState<string | null>(null);
  const [categoryFeedback, setCategoryFeedback] = React.useState('');

  const handleProfileKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpenProfile();
  };

  React.useEffect(() => {
    if (!categoryManagerOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (categoryManagerRef.current?.contains(event.target as Node)) return;
      setCategoryManagerOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCategoryManagerOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [categoryManagerOpen]);

  React.useEffect(() => {
    if (!categoryManagerOpen) {
      setCategoryDraft('');
      setCategoryFeedback('');
      setDeletingCategoryName(null);
    }
  }, [categoryManagerOpen]);

  const handleCreateCategory = React.useCallback(async () => {
    const normalized = normalizeTaxonomyValue(categoryDraft);
    if (!normalized || isCreatingCategory) return;

    try {
      setIsCreatingCategory(true);
      const created = await onCreateCategory(normalized);
      setCategoryDraft('');
      setCategoryFeedback(`Categoria "${created}" criada com sucesso.`);
    } catch {
      setCategoryFeedback('Nao foi possivel criar a categoria agora. Tente novamente.');
    } finally {
      setIsCreatingCategory(false);
    }
  }, [categoryDraft, isCreatingCategory, onCreateCategory]);

  const handleDeleteCategory = React.useCallback(async (name: string) => {
    if (!name || deletingCategoryName === name) return;

    try {
      setDeletingCategoryName(name);
      await onDeleteCategory(name);
      if (filterCategory === name) {
        setFilterCategory('Todas');
      }
      setCategoryFeedback(`Categoria "${name}" excluida com sucesso.`);
    } catch (error) {
      setCategoryFeedback(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel excluir a categoria agora. Tente novamente.',
      );
    } finally {
      setDeletingCategoryName(null);
    }
  }, [deletingCategoryName, filterCategory, onDeleteCategory, setFilterCategory]);

  const categorySummary = categories.map((category) => ({
    category,
    count: pendingTasks.filter((task) => task.category === category).length,
  }));

  return (
    <aside className="hidden h-full w-[292px] shrink-0 flex-col p-4 lg:flex xl:w-[320px] xl:p-5">
      <div className="surface-panel flex h-full flex-col p-5 xl:p-5">
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_18px_40px_-24px_rgba(37,99,235,0.7)]">
              <Target size={24} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                Organização pessoal
              </p>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                Lembreto
              </h1>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.04]">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Pendentes</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{pendingTasks.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.04]">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Categorias</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{categories.length}</p>
            </div>
          </div>
        </div>

        <nav className="space-y-2">
          <SidebarItem
            active={activeTab === 'dashboard'}
            onClick={() => setActiveTab('dashboard')}
            icon={<LayoutDashboard size={20} />}
            label="Painel"
            testId="sidebar-dashboard"
          />
          <SidebarItem
            active={activeTab === 'calendar'}
            onClick={() => setActiveTab('calendar')}
            icon={<CalendarDays size={20} />}
            label="Calendário"
            testId="sidebar-calendar"
          />
          <SidebarItem
            active={activeTab === 'tasks'}
            onClick={() => setActiveTab('tasks')}
            icon={<ListTodo size={20} />}
            label="Meus lembretes"
            badge={overdueCount}
            badgeTone="alert"
            testId="sidebar-tasks"
          />
          <SidebarItem
            active={activeTab === 'notes'}
            onClick={() => setActiveTab('notes')}
            icon={<NotebookPen size={20} />}
            label="Minhas notas"
            testId="sidebar-notes"
          />
        </nav>

        <div className="mt-8 flex-1 overflow-y-auto pr-1">
          <div ref={categoryManagerRef} className="relative mb-3 flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              Categorias
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 dark:text-slate-500">Filtro rápido</span>
              <button
                type="button"
                onClick={() => setCategoryManagerOpen((current) => !current)}
                aria-label="Gerenciar categorias"
                aria-expanded={categoryManagerOpen}
                data-testid="sidebar-category-manager-button"
                title="Gerenciar categorias"
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:border-blue-500/30 dark:hover:bg-blue-500/10 dark:hover:text-blue-300"
              >
                <Plus size={16} />
              </button>
            </div>

            <AnimatePresence>
              {categoryManagerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4"
                >
                  <div
                    role="dialog"
                    aria-label="Gerenciar categorias"
                    className="pointer-events-auto w-full max-w-sm rounded-[22px] border border-slate-200/90 bg-white p-4 text-left shadow-[0_28px_70px_-32px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-slate-950"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                          <FolderPlus size={16} />
                          Categorias
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          Crie e exclua categorias do seu fluxo.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCategoryManagerOpen(false)}
                        aria-label="Fechar categorias"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.08] dark:hover:text-white"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="mt-4 space-y-2">
                      <input
                        type="text"
                        value={categoryDraft}
                        data-testid="sidebar-category-create-input"
                        onChange={(event) => setCategoryDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleCreateCategory();
                          }
                        }}
                        placeholder="Ex.: Saude, Financeiro..."
                        className="field-control min-h-[44px] px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        data-testid="sidebar-category-create-button"
                        onClick={() => {
                          void handleCreateCategory();
                        }}
                        disabled={isCreatingCategory || !normalizeTaxonomyValue(categoryDraft)}
                        className="action-secondary min-h-[44px] w-full justify-center rounded-xl px-4 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isCreatingCategory ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                        Criar categoria
                      </button>
                    </div>

                    <div className="mt-4 max-h-48 space-y-2 overflow-y-auto pr-1">
                      {categories.map((item) => {
                        const isDeleting = deletingCategoryName === item;
                        const canDelete = !isDefaultCategory(item);

                        return (
                          <div
                            key={item}
                            className="flex min-h-[38px] items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
                          >
                            <span className="min-w-0 truncate">{item}</span>
                            {canDelete ? (
                              <button
                                type="button"
                                aria-label={`Excluir categoria ${item}`}
                                data-testid={`sidebar-category-delete-${item}`}
                                onClick={() => {
                                  void handleDeleteCategory(item);
                                }}
                                disabled={isDeleting}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300"
                              >
                                {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {categoryFeedback && (
                      <p className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                        {categoryFeedback}
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-2">
            <FilterTag
              active={filterCategory === 'Todas'}
              onClick={() => {
                setFilterCategory('Todas');
                setActiveTab('tasks');
              }}
              label="Todas"
              count={pendingTasks.length}
            />
            {categorySummary.map(({ category, count }) => (
              <FilterTag
                key={category}
                active={filterCategory === category}
                onClick={() => {
                  setFilterCategory(category);
                  setActiveTab('tasks');
                }}
                label={category}
                count={count}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-3 border-t border-slate-200/80 pt-5 dark:border-white/10">
          <div
            onClick={onOpenProfile}
            onKeyDown={handleProfileKeyDown}
            role="button"
            tabIndex={0}
            aria-label="Abrir perfil"
            data-testid="sidebar-profile-button"
            className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4 transition-all hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.06]"
          >
            <div className="flex items-center gap-3">
              {currentUser.avatar ? (
                <img
                  src={currentUser.avatar}
                  alt="Avatar"
                  data-testid="sidebar-profile-avatar"
                  className="h-11 w-11 rounded-2xl object-cover"
                />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                  <UserIcon size={20} />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p data-testid="sidebar-profile-name" className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {currentUser.name}
                </p>
                <p data-testid="sidebar-profile-email" className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {currentUser.email}
                </p>
              </div>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onLogout();
                }}
                data-testid="sidebar-logout"
                className="flex h-10 w-10 items-center justify-center rounded-2xl text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                title="Sair"
                aria-label="Sair da conta"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>

          <button
            onClick={() => onOpenSettings()}
            data-testid="sidebar-settings-button"
            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Settings size={16} />
              Configurações
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
