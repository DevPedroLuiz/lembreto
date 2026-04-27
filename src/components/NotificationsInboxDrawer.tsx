import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, BellRing, X } from 'lucide-react';
import { useSwipeToClose } from '../hooks/useSwipeToClose';
import { NotificationFeed } from './NotificationFeed';
import type { AppNotification } from '../types';

interface NotificationsInboxDrawerProps {
  open: boolean;
  notifications: AppNotification[];
  unreadCount: number;
  onClose: () => void;
  onOpenNotification: (notification: AppNotification) => void;
  onOpenCenter: () => void;
}

export function NotificationsInboxDrawer({
  open,
  notifications,
  unreadCount,
  onClose,
  onOpenNotification,
  onOpenCenter,
}: NotificationsInboxDrawerProps) {
  const recentNotifications = notifications.slice(0, 6);
  const swipe = useSwipeToClose({
    enabled: open,
    direction: 'right',
    onClose,
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[140] bg-slate-950/45 backdrop-blur-sm"
          />

          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: swipe.offset }}
            exit={{ x: '100%' }}
            transition={swipe.isDragging ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 240 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="notifications-inbox-title"
            className="fixed right-0 top-0 z-[141] flex h-full w-full max-w-xl flex-col border-l border-slate-200/80 bg-white/96 shadow-[0_0_0_1px_rgba(15,23,42,0.02),0_24px_80px_-28px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94"
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

            <div className="border-b border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="section-eyebrow">
                    <BellRing size={14} />
                    Atualizações recentes
                  </span>
                  <h2
                    id="notifications-inbox-title"
                    className="mt-4 text-2xl font-semibold text-slate-950 dark:text-white"
                  >
                    Notificações
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    Veja os avisos mais recentes e abra cada contexto com um clique.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar notificações"
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                  {recentNotifications.length} recente{recentNotifications.length === 1 ? '' : 's'}
                </span>
                <span className="rounded-full bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                  {unreadCount} não lida{unreadCount === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-7">
              <NotificationFeed
                notifications={recentNotifications}
                onOpenNotification={onOpenNotification}
                emptyTitle="Sua caixa está tranquila"
                emptyDescription="Quando o sistema tiver novos avisos, eles vão aparecer primeiro aqui."
                itemTestId="recent-notification-item"
              />
            </div>

            <div className="border-t border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <button
                type="button"
                onClick={onOpenCenter}
                className="action-secondary ml-auto"
                data-testid="notifications-open-center"
              >
                Ir para a central de notificações
                <span className="icon-slot h-4 w-4">
                  <ArrowRight size={16} />
                </span>
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
