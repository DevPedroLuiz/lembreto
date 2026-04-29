import React from 'react';
import {
  ChevronRight,
  LayoutDashboard,
  ListTodo,
  LogOut,
  NotebookPen,
  Settings,
  Target,
  User as UserIcon,
} from 'lucide-react';
import { SidebarItem } from './SidebarItem';
import { FilterTag } from './FilterTag';
import type { Task, User } from '../types';

interface SidebarProps {
  currentUser: User;
  activeTab: 'dashboard' | 'tasks' | 'notes' | 'notifications';
  setActiveTab: (tab: 'dashboard' | 'tasks' | 'notes' | 'notifications') => void;
  categories: string[];
  filterCategory: string;
  setFilterCategory: (cat: string) => void;
  pendingTasks: Task[];
  overdueCount: number;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
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
  onLogout,
}: SidebarProps) {
  const handleProfileKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpenProfile();
  };

  const categorySummary = categories.map((category) => ({
    category,
    count: pendingTasks.filter((task) => task.category === category).length,
  }));

  return (
    <aside className="hidden h-full w-[320px] shrink-0 flex-col p-5 md:flex">
      <div className="surface-panel flex h-full flex-col p-5">
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
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              Categorias
            </h2>
            <span className="text-xs text-slate-400 dark:text-slate-500">Filtro rápido</span>
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
            onClick={onOpenSettings}
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
