import React from 'react';
import { CalendarDays, ChevronRight, Clock3, Info, ShieldAlert } from 'lucide-react';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { AppNotification, OverdueNotificationSnoozePreset } from '../types';

interface NotificationFeedProps {
  notifications: AppNotification[];
  onOpenNotification: (notification: AppNotification) => void;
  onPreviewNotification?: (notification: AppNotification) => void;
  onSnoozeOverdueNotification?: (
    notification: AppNotification,
    preset: OverdueNotificationSnoozePreset,
  ) => void;
  isNotificationActionBusy?: (notification: AppNotification) => boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  itemTestId?: string;
}

const overdueSnoozeActions: Array<{
  preset: OverdueNotificationSnoozePreset;
  label: string;
  icon: React.ReactNode;
}> = [
  { preset: 'tenMinutes', label: 'Lembrar em 10 min', icon: <Clock3 size={14} /> },
  { preset: 'oneHour', label: '1 hora', icon: <Clock3 size={14} /> },
  { preset: 'tomorrow', label: 'Amanhã', icon: <CalendarDays size={14} /> },
];

const toneStyles: Record<AppNotification['tone'], string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  error: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300',
};

function formatRelativeDate(value: string): string {
  try {
    return formatDistanceToNowStrict(parseISO(value), {
      addSuffix: true,
      locale: ptBR,
    });
  } catch {
    return 'Agora mesmo';
  }
}

function getToneLabel(tone: AppNotification['tone']): string {
  if (tone === 'success') return 'Sucesso';
  if (tone === 'warning') return 'Aviso';
  if (tone === 'error') return 'Erro';
  return 'Informação';
}

function getActionLabel(notification: AppNotification): string {
  if (notification.target?.type === 'task') return 'Abrir lembrete';
  if (notification.target?.type === 'profile') return 'Abrir perfil';
  if (notification.target?.type === 'settings') return 'Abrir configurações';
  return 'Abrir';
}

export function NotificationFeed({
  notifications,
  onOpenNotification,
  onPreviewNotification,
  onSnoozeOverdueNotification,
  isNotificationActionBusy,
  emptyTitle = 'Nenhuma notificação por aqui',
  emptyDescription = 'Quando o sistema gerar novos avisos e confirmações, eles vão aparecer aqui.',
  itemTestId = 'notification-item',
}: NotificationFeedProps) {
  if (notifications.length === 0) {
    return (
      <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/80 px-6 py-16 text-center dark:border-white/10 dark:bg-white/[0.03]">
        <ShieldAlert size={38} className="mx-auto mb-4 text-slate-400" />
        <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
          {emptyTitle}
        </h4>
        <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
          {emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notifications.map((notification) => {
        const isInteractive = Boolean(notification.target);
        const canSnoozeOverdue = Boolean(
          notification.kind === 'overdue_reminder' &&
          notification.target?.type === 'task' &&
          onSnoozeOverdueNotification,
        );
        const actionBusy = isNotificationActionBusy?.(notification) ?? false;

        return (
          <article
            key={notification.id}
            data-testid={itemTestId}
            role={isInteractive ? 'button' : undefined}
            tabIndex={isInteractive ? 0 : -1}
            aria-label={isInteractive ? `Abrir notificação ${notification.title}` : undefined}
            onClick={isInteractive ? () => onOpenNotification(notification) : undefined}
            onMouseEnter={() => {
              if (!notification.read) {
                onPreviewNotification?.(notification);
              }
            }}
            onFocus={() => {
              if (!notification.read) {
                onPreviewNotification?.(notification);
              }
            }}
            onKeyDown={isInteractive ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onOpenNotification(notification);
            } : undefined}
            className={[
              'rounded-[28px] border px-5 py-5 transition-colors',
              isInteractive ? 'cursor-pointer hover:border-slate-300 dark:hover:border-white/20' : '',
              notification.read
                ? 'border-slate-200 bg-slate-50/80 dark:border-white/10 dark:bg-white/[0.03]'
                : 'border-blue-200 bg-white shadow-[0_18px_42px_-30px_rgba(37,99,235,0.25)] dark:border-blue-500/20 dark:bg-white/[0.05]',
            ].join(' ')}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={[
                      'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em]',
                      toneStyles[notification.tone],
                    ].join(' ')}
                  >
                    {getToneLabel(notification.tone)}
                  </span>

                  {!notification.read && (
                    <span className="inline-flex items-center rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white">
                      Nova
                    </span>
                  )}
                </div>

                <h4 className="mt-3 text-base font-semibold text-slate-950 dark:text-white">
                  {notification.title}
                </h4>
                <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
                  {notification.message}
                </p>

                {isInteractive && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenNotification(notification);
                      }}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
                    >
                      {getActionLabel(notification)}
                      <ChevronRight size={14} />
                    </button>

                    {canSnoozeOverdue && overdueSnoozeActions.map((action) => (
                      <button
                        key={action.preset}
                        type="button"
                        disabled={actionBusy}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSnoozeOverdueNotification?.(notification, action.preset);
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:bg-amber-500/15"
                      >
                        {action.icon}
                        {actionBusy ? 'Adiando...' : action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                <Info size={14} />
                {formatRelativeDate(notification.createdAt)}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
