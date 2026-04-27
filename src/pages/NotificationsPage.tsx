import React from 'react';
import { BellRing, CheckCheck, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { NotificationFeed } from '../components/NotificationFeed';
import type { AppNotification } from '../types';

type NotificationVisibility = 'all' | 'unread' | 'read';
type NotificationToneFilter = 'all' | AppNotification['tone'];

interface NotificationsPageProps {
  notifications: AppNotification[];
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onOpenNotification: (notification: AppNotification) => void;
}

function FilterButton({
  active,
  children,
  onClick,
  testId,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={[
        'inline-flex h-10 items-center justify-center rounded-xl px-3 text-sm font-semibold transition-all',
        active
          ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-[0_12px_24px_-18px_rgba(37,99,235,0.7)]'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function NotificationsPage({
  notifications,
  onMarkAllRead,
  onClearAll,
  onOpenNotification,
}: NotificationsPageProps) {
  const [search, setSearch] = React.useState('');
  const [visibility, setVisibility] = React.useState<NotificationVisibility>('all');
  const [toneFilter, setToneFilter] = React.useState<NotificationToneFilter>('all');
  const [feedbackMessage, setFeedbackMessage] = React.useState('');

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  const filteredNotifications = React.useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');

    return notifications.filter((notification) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        notification.title.toLocaleLowerCase('pt-BR').includes(normalizedSearch) ||
        notification.message.toLocaleLowerCase('pt-BR').includes(normalizedSearch);

      const matchesVisibility =
        visibility === 'all' ||
        (visibility === 'unread' && !notification.read) ||
        (visibility === 'read' && notification.read);

      const matchesTone = toneFilter === 'all' || notification.tone === toneFilter;

      return matchesSearch && matchesVisibility && matchesTone;
    });
  }, [notifications, search, toneFilter, visibility]);

  React.useEffect(() => {
    if (!feedbackMessage) return undefined;

    const timeoutId = window.setTimeout(() => setFeedbackMessage(''), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [feedbackMessage]);

  const handleMarkAllRead = React.useCallback(() => {
    onMarkAllRead();
    setFeedbackMessage('Tudo marcado como lido.');
  }, [onMarkAllRead]);

  const handleClearAll = React.useCallback(() => {
    onClearAll();
    setFeedbackMessage('Histórico de notificações limpo.');
  }, [onClearAll]);

  return (
    <motion.div
      key="notifications"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <section className="surface-panel p-5 md:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="section-eyebrow">
              <BellRing size={14} />
              Central de notificações
            </span>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Tudo o que aconteceu no sistema, em um só lugar.
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
              Acompanhe ações importantes, confirmações e alertas recentes sem depender apenas dos avisos temporários da tela.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="action-secondary"
              disabled={notifications.length === 0 || unreadCount === 0}
              data-testid="notifications-mark-all-read"
            >
              <CheckCheck size={18} />
              Marcar tudo como lido
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 font-semibold text-rose-700 transition-all hover:-translate-y-0.5 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15"
              disabled={notifications.length === 0}
              data-testid="notifications-clear-all"
            >
              <Trash2 size={18} />
              Limpar histórico
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
            {notifications.length} no histórico
          </span>
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
            {unreadCount} não lida{unreadCount === 1 ? '' : 's'}
          </span>
          {feedbackMessage && (
            <span
              data-testid="notifications-feedback"
              className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
            >
              {feedbackMessage}
            </span>
          )}
        </div>
      </section>

      <section className="surface-panel p-5 md:p-6">
        <div className="space-y-5">
          <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-5 dark:border-white/10">
            <div className="relative">
              <Search className="field-icon" size={18} />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar notificações por título ou conteúdo"
                className="field-control field-control-with-icon"
                data-testid="notifications-search-input"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="icon-slot h-8 w-8 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                    <SlidersHorizontal size={15} />
                  </span>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Visualização</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <FilterButton active={visibility === 'all'} onClick={() => setVisibility('all')}>
                    Todas
                  </FilterButton>
                  <FilterButton active={visibility === 'unread'} onClick={() => setVisibility('unread')}>
                    Não lidas
                  </FilterButton>
                  <FilterButton active={visibility === 'read'} onClick={() => setVisibility('read')}>
                    Lidas
                  </FilterButton>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="icon-slot h-8 w-8 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                    <BellRing size={15} />
                  </span>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Tipo</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <FilterButton active={toneFilter === 'all'} onClick={() => setToneFilter('all')}>
                    Todas
                  </FilterButton>
                  <FilterButton active={toneFilter === 'info'} onClick={() => setToneFilter('info')}>
                    Informações
                  </FilterButton>
                  <FilterButton active={toneFilter === 'success'} onClick={() => setToneFilter('success')}>
                    Sucessos
                  </FilterButton>
                  <FilterButton active={toneFilter === 'warning'} onClick={() => setToneFilter('warning')}>
                    Avisos
                  </FilterButton>
                  <FilterButton active={toneFilter === 'error'} onClick={() => setToneFilter('error')}>
                    Erros
                  </FilterButton>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
              Exibindo {filteredNotifications.length} resultado{filteredNotifications.length === 1 ? '' : 's'}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
              {visibility === 'all' ? 'Todas as leituras' : visibility === 'unread' ? 'Somente não lidas' : 'Somente lidas'}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
              {toneFilter === 'all' ? 'Todos os tipos' : `Tipo: ${toneFilter === 'info' ? 'Informação' : toneFilter === 'success' ? 'Sucesso' : toneFilter === 'warning' ? 'Aviso' : 'Erro'}`}
            </span>
          </div>

          <NotificationFeed
            notifications={filteredNotifications}
            onOpenNotification={onOpenNotification}
            emptyTitle="Nenhuma notificação por aqui"
            emptyDescription="Quando o sistema gerar novos avisos e confirmações, eles vão aparecer nesta central."
          />
        </div>
      </section>
    </motion.div>
  );
}
