import { Bot, User } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface AssistantChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
}

interface AssistantMessageProps {
  message: AssistantChatMessage;
}

export function AssistantMessage({ message }: AssistantMessageProps) {
  const isUser = message.role === 'user';

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
          'max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm',
          isUser
            ? 'bg-blue-600 text-white'
            : 'border border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100',
        )}
      >
        {message.content}
      </div>
      {isUser && (
        <span className="icon-slot mt-1 h-8 w-8 rounded-2xl bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-300">
          <User size={16} />
        </span>
      )}
    </div>
  );
}
