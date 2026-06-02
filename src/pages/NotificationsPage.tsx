import React from 'react';
import { BellRing, CalendarDays, CheckCheck, Loader2, RefreshCw, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { NotificationFeed } from '../components/NotificationFeed';
import type { NotificationListQuery, NotificationPageInfo } from '../hooks/useNotifications';
import type {
  AppNotification,
  NotificationScheduleDiagnostics,
  NotificationScheduleQueueItem,
  OverdueNotificationSnoozePreset,
} from '../types';

type NotificationVisibility = 'all' | 'unread' | 'read';
type NotificationToneFilter = 'all' | AppNotification['tone'];
type NotificationKindFilter = 'all' | NonNullable<AppNotification['kind']>;
type ScheduleStatusFilter = 'all' | NotificationScheduleQueueItem['status'];

interface NotificationsPageProps {
  notifications: AppNotification[];
  pageInfo: NotificationPageInfo;
  isLoadingMore: boolean;
  onMarkAllRead: () => void;
  onClearAll: (filters?: NotificationListQuery) => void;
  onFiltersChange: (filters: NotificationListQuery) => void;
  onLoadMore: () => void;
  onOpenNotification: (notification: AppNotification) => void;
  onSnoozeOverdueNotification: (
    notification: AppNotification,
    preset: OverdueNotificationSnoozePreset,
  ) => void;
  isNotificationActionBusy: (notification: AppNotification) => boolean;
  scheduleQueue?: NotificationScheduleQueueItem[];
  scheduleDiagnostics?: NotificationScheduleDiagnostics | null;
  isLoadingScheduleQueue?: boolean;
  onRefreshScheduleQueue?: (status?: NotificationScheduleQueueItem['status'] | null) => void;
  onProcessDueNotifications?: (status?: NotificationScheduleQueueItem['status'] | null) => void;
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

function getKindLabel(kind: NotificationKindFilter) {
  if (kind === 'pre_notice') return 'Pre-aviso';
  if (kind === 'notification') return 'Notificação';
  if (kind === 'alarm') return 'Alarme';
  if (kind === 'floating_reminder') return 'Lembrete flutuante';
  if (kind === 'overdue_reminder') return 'Atraso';
  return 'Todas as origens';
}

function getScheduleKindLabel(kind: NotificationScheduleQueueItem['kind']) {
  if (kind === 'pre_notice') return 'Pré-aviso';
  if (kind === 'notification') return 'No horário';
  if (kind === 'alarm') return 'Alarme';
  if (kind === 'floating_reminder') return 'Sem horário';
  return 'Atrasado';
}

function getScheduleStatusLabel(status: NotificationScheduleQueueItem['status']) {
  if (status === 'pending') return 'Pendente';
  if (status === 'processing') return 'Processando';
  if (status === 'sent') return 'Enviado';
  if (status === 'failed') return 'Erro';
  return 'Cancelado';
}

function getScheduleStatusFilterLabel(status: ScheduleStatusFilter) {
  if (status === 'all') return 'Todos os status';
  return getScheduleStatusLabel(status);
}

function getScheduleStatusStyle(status: NotificationScheduleQueueItem['status']) {
  if (status === 'pending') return 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300';
  if (status === 'processing') return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300';
  if (status === 'sent') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
  if (status === 'failed') return 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300';
  return 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300';
}

function formatScheduleDate(value: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return 'Data indisponível';
  }
}

export function NotificationsPage({
  notifications,
  pageInfo,
  isLoadingMore,
  onMarkAllRead,
  onClearAll,
  onFiltersChange,
  onLoadMore,
  onOpenNotification,
  onSnoozeOverdueNotification,
  isNotificationActionBusy,
  scheduleQueue = [],
  scheduleDiagnostics = null,
  isLoadingScheduleQueue = false,
  onRefreshScheduleQueue,
  onProcessDueNotifications,
}: NotificationsPageProps) {
  const [activeView, setActiveView] = React.useState<'feed' | 'queue'>('feed');
  const [search, setSearch] = React.useState('');
  const [visibility, setVisibility] = React.useState<NotificationVisibility>('all');
  const [toneFilter, setToneFilter] = React.useState<NotificationToneFilter>('all');
  const [kindFilter, setKindFilter] = React.useState<NotificationKindFilter>('all');
  const [scheduleStatusFilter, setScheduleStatusFilter] = React.useState<ScheduleStatusFilter>('all');
  const [createdFrom, setCreatedFrom] = React.useState('');
  const [createdTo, setCreatedTo] = React.useState('');
  const [feedbackMessage, setFeedbackMessage] = React.useState('');

  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const currentFilters = React.useMemo<NotificationListQuery>(() => ({
    search: search.trim() || undefined,
    read: visibility === 'all' ? null : visibility === 'read',
    tone: toneFilter === 'all' ? null : toneFilter,
    kind: kindFilter === 'all' ? null : kindFilter,
    createdFrom: createdFrom || null,
    createdTo: createdTo || null,
  }), [createdFrom, createdTo, kindFilter, search, toneFilter, visibility]);
  const hasActiveFilters = Boolean(
    currentFilters.search ||
    currentFilters.read !== null ||
    currentFilters.tone ||
    currentFilters.kind ||
    currentFilters.createdFrom ||
    currentFilters.createdTo,
  );
  const queueStatusCounts = React.useMemo(() => (
    scheduleQueue.reduce<Record<NotificationScheduleQueueItem['status'], number>>((counts, schedule) => ({
      ...counts,
      [schedule.status]: counts[schedule.status] + 1,
    }), {
      pending: 0,
      processing: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
    })
  ), [scheduleQueue]);

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => onFiltersChange(currentFilters), 300);
    return () => window.clearTimeout(timeoutId);
  }, [currentFilters, onFiltersChange]);

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
    onClearAll(hasActiveFilters ? currentFilters : undefined);
    setFeedbackMessage(hasActiveFilters ? 'Notificações filtradas removidas.' : 'Histórico de notificações limpo.');
  }, [currentFilters, hasActiveFilters, onClearAll]);

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
            <h3 className="mt-4 text-[2rem] font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
              Tudo o que aconteceu no sistema, em um só lugar.
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
              Acompanhe ações importantes, confirmações e alertas recentes sem depender apenas dos avisos temporários da tela.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="action-secondary w-full justify-center sm:w-auto"
              disabled={notifications.length === 0 || unreadCount === 0}
              data-testid="notifications-mark-all-read"
            >
              <CheckCheck size={18} />
              Marcar tudo como lido
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 font-semibold text-rose-700 transition-all hover:-translate-y-0.5 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15 sm:w-auto"
              disabled={notifications.length === 0}
              data-testid="notifications-clear-all"
            >
              <Trash2 size={18} />
              {hasActiveFilters ? 'Limpar resultados' : 'Limpar histórico'}
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
            {notifications.length} carregada{notifications.length === 1 ? '' : 's'}
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

        <div className="mt-6 inline-flex rounded-2xl bg-slate-100 p-1 dark:bg-white/[0.06]">
          <button
            type="button"
            onClick={() => setActiveView('feed')}
            className={[
              'rounded-xl px-4 py-2 text-sm font-semibold transition-all',
              activeView === 'feed' ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-300',
            ].join(' ')}
          >
            Histórico
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveView('queue');
              onRefreshScheduleQueue?.(scheduleStatusFilter === 'all' ? null : scheduleStatusFilter);
            }}
            className={[
              'rounded-xl px-4 py-2 text-sm font-semibold transition-all',
              activeView === 'queue' ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-300',
            ].join(' ')}
          >
            Fila de avisos
          </button>
        </div>
      </section>

      {activeView === 'feed' ? (
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

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="icon-slot h-8 w-8 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                    <SlidersHorizontal size={15} />
                  </span>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Origem</p>
                </div>
                <select
                  value={kindFilter}
                  onChange={(event) => setKindFilter(event.target.value as NotificationKindFilter)}
                  className="field-control"
                  data-testid="notifications-kind-filter"
                >
                  <option value="all">Todas as origens</option>
                  <option value="pre_notice">Pre-aviso</option>
                  <option value="notification">Notificação</option>
                  <option value="alarm">Alarme</option>
                  <option value="floating_reminder">Lembrete flutuante</option>
                  <option value="overdue_reminder">Atraso</option>
                </select>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="icon-slot h-8 w-8 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                    <CalendarDays size={15} />
                  </span>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Período</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="date"
                    value={createdFrom}
                    onChange={(event) => setCreatedFrom(event.target.value)}
                    className="field-control"
                    aria-label="Data inicial"
                    data-testid="notifications-created-from"
                  />
                  <input
                    type="date"
                    value={createdTo}
                    onChange={(event) => setCreatedTo(event.target.value)}
                    className="field-control"
                    aria-label="Data final"
                    data-testid="notifications-created-to"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
              Exibindo {notifications.length} resultado{notifications.length === 1 ? '' : 's'}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
              {visibility === 'all' ? 'Todas as leituras' : visibility === 'unread' ? 'Somente não lidas' : 'Somente lidas'}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
              {toneFilter === 'all' ? 'Todos os tipos' : `Tipo: ${toneFilter === 'info' ? 'Informação' : toneFilter === 'success' ? 'Sucesso' : toneFilter === 'warning' ? 'Aviso' : 'Erro'}`}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
              {getKindLabel(kindFilter)}
            </span>
            {hasActiveFilters && (
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                Filtros aplicados no servidor
              </span>
            )}
          </div>

          <NotificationFeed
            notifications={notifications}
            onOpenNotification={onOpenNotification}
            onSnoozeOverdueNotification={onSnoozeOverdueNotification}
            isNotificationActionBusy={isNotificationActionBusy}
            emptyTitle="Nenhuma notificação por aqui"
            emptyDescription="Quando o sistema gerar novos avisos e confirmações, eles vão aparecer nesta central."
          />

          {pageInfo.hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="action-secondary justify-center"
                data-testid="notifications-load-more"
              >
                {isLoadingMore ? <Loader2 size={18} className="animate-spin" /> : null}
                Carregar mais
              </button>
            </div>
          )}
        </div>
      </section>
      ) : (
      <section className="surface-panel p-5 md:p-6" data-testid="notification-schedule-queue">
        <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-5 dark:border-white/10 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">Fila de notificações</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Diagnóstico dos avisos pendentes, enviados, cancelados ou com erro.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => onRefreshScheduleQueue?.(scheduleStatusFilter === 'all' ? null : scheduleStatusFilter)}
              disabled={isLoadingScheduleQueue}
              className="action-secondary justify-center"
            >
              {isLoadingScheduleQueue ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
              Atualizar
            </button>
            <button
              type="button"
              onClick={() => onProcessDueNotifications?.(scheduleStatusFilter === 'all' ? null : scheduleStatusFilter)}
              className="action-secondary justify-center"
            >
              Processar vencidos
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:items-end">
          <div>
            <label htmlFor="notification-schedule-status-filter" className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              Status da fila
            </label>
            <select
              id="notification-schedule-status-filter"
              value={scheduleStatusFilter}
              onChange={(event) => {
                const next = event.target.value as ScheduleStatusFilter;
                setScheduleStatusFilter(next);
                onRefreshScheduleQueue?.(next === 'all' ? null : next);
              }}
              className="field-control"
              data-testid="notification-schedule-status-filter"
            >
              <option value="all">Todos os status</option>
              <option value="pending">Pendentes</option>
              <option value="processing">Processando</option>
              <option value="sent">Enviados</option>
              <option value="cancelled">Cancelados</option>
              <option value="failed">Com erro</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['pending', 'processing', 'sent', 'cancelled', 'failed'] as const).map((status) => (
              <span key={status} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${getScheduleStatusStyle(status)}`}>
                {getScheduleStatusLabel(status)}: {queueStatusCounts[status]}
              </span>
            ))}
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
              Filtro: {getScheduleStatusFilterLabel(scheduleStatusFilter)}
            </span>
          </div>
        </div>

        {scheduleDiagnostics && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <span className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              {scheduleDiagnostics.duePendingCount} vencido{scheduleDiagnostics.duePendingCount === 1 ? '' : 's'}
            </span>
            <span className="rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
              {scheduleDiagnostics.futurePendingCount} futuro{scheduleDiagnostics.futurePendingCount === 1 ? '' : 's'}
            </span>
            <span className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {scheduleDiagnostics.failedCount} com erro
            </span>
            <span className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
              {scheduleDiagnostics.processingCount} processando
            </span>
          </div>
        )}

        <div className="mt-5 space-y-3">
          {scheduleQueue.length === 0 && !isLoadingScheduleQueue ? (
            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
              Nenhum aviso encontrado na fila.
            </div>
          ) : (
            scheduleQueue.map((schedule) => (
              <div
                key={schedule.id}
                className="grid gap-3 rounded-3xl border border-slate-200 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04] lg:grid-cols-[minmax(0,1fr)_auto_auto]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{schedule.taskTitle}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {schedule.title} - {schedule.message}
                  </p>
                  {schedule.errorMessage && (
                    <p className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-300">{schedule.errorMessage}</p>
                  )}
                </div>
                <span className="inline-flex h-8 w-fit items-center rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                  {getScheduleKindLabel(schedule.kind)}
                </span>
                <div className="text-left text-xs text-slate-500 dark:text-slate-400 lg:text-right">
                  <p className="font-semibold text-slate-700 dark:text-slate-200">{getScheduleStatusLabel(schedule.status)}</p>
                  <p className="mt-1">{formatScheduleDate(schedule.notifyAt)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      )}
    </motion.div>
  );
}
