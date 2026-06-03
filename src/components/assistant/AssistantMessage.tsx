import { ArrowRight, Bot, CheckCircle2, FileText, User } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { AssistantActionResult } from '../../lib/assistantApi';

export interface AssistantMessageAction {
  type: string;
  entityType: 'task' | 'note';
  entityId: string;
  entityTitle?: string;
}

export interface AssistantChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  action?: AssistantMessageAction;
}

interface AssistantMessageProps {
  message: AssistantChatMessage;
  onOpenAction?: (action: AssistantMessageAction) => void | Promise<void>;
}

const actionLabels: Record<string, string> = {
  create_task: 'Lembrete criado',
  update_task: 'Lembrete atualizado',
  create_note: 'Nota criada',
};

function getActionLabel(action: AssistantMessageAction) {
  return actionLabels[action.type] ?? (action.entityType === 'note' ? 'Nota pronta' : 'Lembrete pronto');
}

export function getAssistantMessageAction(action: AssistantActionResult): AssistantMessageAction | undefined {
  if (
    action.status !== 'success' ||
    !action.entityId ||
    (action.entityType !== 'task' && action.entityType !== 'note')
  ) {
    return undefined;
  }

  return {
    type: action.type,
    entityType: action.entityType,
    entityId: action.entityId,
    entityTitle: action.entityTitle,
  };
}

export function AssistantMessage({ message, onOpenAction }: AssistantMessageProps) {
  const isUser = message.role === 'user';
  const action = message.action;
  const ActionIcon = action?.entityType === 'note' ? FileText : CheckCircle2;

  return (
    <div
      className={cn(
        'flex items-start gap-2',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      {!isUser && (
        <span className="icon-slot mt-1 h-8 w-8 rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
          <Bot size={16} />
        </span>
      )}
      <div
        className={cn(
          'max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm',
          isUser
            ? 'bg-blue-600 text-white'
            : 'border border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100',
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {action && (
          <button
            type="button"
            onClick={() => void onOpenAction?.(action)}
            className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-left text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/15"
            data-testid="assistant-action-open-button"
          >
            <span className="icon-slot h-8 w-8 shrink-0 rounded-xl bg-emerald-500 text-white">
              <ActionIcon size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold uppercase tracking-[0.12em]">
                {getActionLabel(action)}
              </span>
              <span className="block truncate text-sm font-semibold">
                {action.entityTitle ?? 'Abrir item'}
              </span>
            </span>
            <ArrowRight size={16} className="shrink-0" />
          </button>
        )}
      </div>
      {isUser && (
        <span className="icon-slot mt-1 h-8 w-8 rounded-2xl bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-300">
          <User size={16} />
        </span>
      )}
    </div>
  );
}
