// src/components/Sidebar.tsx
import React from 'react';
import {
  Target,
  LayoutDashboard,
  ListTodo,
  LogOut,
  User as UserIcon,
  Settings,
  ChevronRight,
} from 'lucide-react';
import { SidebarItem } from './SidebarItem';
import { FilterTag } from './FilterTag';
import { CATEGORIES } from '../types';
import type { Task, User } from '../types';

interface SidebarProps {
  currentUser: User;
  activeTab: 'dashboard' | 'tasks';
  setActiveTab: (tab: 'dashboard' | 'tasks') => void;
  filterCategory: string;
  setFilterCategory: (cat: string) => void;
  pendingTasks: Task[];
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export function Sidebar({
  currentUser,
  activeTab,
  setActiveTab,
  filterCategory,
  setFilterCategory,
  pendingTasks,
  onOpenProfile,
  onOpenSettings,
  onLogout,
}: SidebarProps) {
  return (
    <aside className="hidden md:flex flex-col w-72 h-full border-r border-slate-200/60 dark:border-white/5 bg-white/50 dark:bg-[#0a0f1e]/80 backdrop-blur-xl shrink-0 p-6">
      {/* Logo */}
      <div className="flex items-center gap-3 px-2 mb-10">
        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-sky-400 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
          <Target size={22} />
        </div>
        <h1 className="font-bold text-xl tracking-tight">Lembreto</h1>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-2">
        <SidebarItem
          active={activeTab === 'dashboard'}
          onClick={() => setActiveTab('dashboard')}
          icon={<LayoutDashboard size={20} />}
          label="Dashboard"
          testId="sidebar-dashboard"
        />
        <SidebarItem
          active={activeTab === 'tasks'}
          onClick={() => setActiveTab('tasks')}
          icon={<ListTodo size={20} />}
          label="Minhas Tarefas"
          badge={pendingTasks.length}
          testId="sidebar-tasks"
        />

        <div className="pt-8 pb-3 px-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Categorias
          </h3>
        </div>

        <FilterTag
          active={filterCategory === 'Todas'}
          onClick={() => { setFilterCategory('Todas'); setActiveTab('tasks'); }}
          label="Todas"
          count={pendingTasks.length}
        />
        {CATEGORIES.map((cat) => (
          <FilterTag
            key={cat}
            active={filterCategory === cat}
            onClick={() => { setFilterCategory(cat); setActiveTab('tasks'); }}
            label={cat}
            count={pendingTasks.filter((t) => t.category === cat).length}
          />
        ))}
      </nav>

      {/* Footer */}
      <div className="mt-auto pt-6 space-y-4">
        <div
          onClick={onOpenProfile}
          data-testid="sidebar-profile-button"
          className="bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 cursor-pointer transition-colors rounded-2xl p-4 flex items-center gap-3"
        >
          {currentUser.avatar ? (
            <img
              src={currentUser.avatar}
              alt="Avatar"
              data-testid="sidebar-profile-avatar"
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center shrink-0">
              <UserIcon size={20} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p data-testid="sidebar-profile-name" className="text-sm font-semibold truncate">{currentUser.name}</p>
            <p data-testid="sidebar-profile-email" className="text-[10px] text-slate-500 truncate">{currentUser.email}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onLogout(); }}
            data-testid="sidebar-logout"
            className="text-slate-400 hover:text-rose-500 transition-colors shrink-0"
            title="Sair"
          >
            <LogOut size={18} />
          </button>
        </div>

        <button
          onClick={onOpenSettings}
          className="flex items-center justify-between w-full px-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 transition-colors"
        >
          <span className="text-sm font-medium flex items-center gap-2">
            <Settings size={16} /> Configurações
          </span>
          <ChevronRight size={16} />
        </button>
      </div>
    </aside>
  );
}
