import React from 'react';
import { BellRing, CheckCheck, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { NotificationFeed } from '../components/NotificationFeed';
import type { AppNotification } from '../types';

interface NotificationsPageProps {
  notifications: AppNotification[];
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onOpenNotification: (notification: AppNotification) => void;
}

export function NotificationsPage({
  notifications,
  onMarkAllRead,
  onClearAll,
  onOpenNotification,
}: NotificationsPageProps) {
  const unreadCount = notifications.filter((notification) => !notification.read).length;

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
              onClick={onMarkAllRead}
              className="action-secondary"
              disabled={notifications.length === 0 || unreadCount === 0}
              data-testid="notifications-mark-all-read"
            >
              <CheckCheck size={18} />
              Marcar tudo como lido
            </button>
            <button
              type="button"
              onClick={onClearAll}
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
        </div>
      </section>

      <section className="surface-panel p-5 md:p-6">
        <NotificationFeed
          notifications={notifications}
          onOpenNotification={onOpenNotification}
          emptyTitle="Nenhuma notificação por aqui"
          emptyDescription="Quando o sistema gerar novos avisos e confirmações, eles vão aparecer nesta central."
        />
      </section>
    </motion.div>
  );
}
