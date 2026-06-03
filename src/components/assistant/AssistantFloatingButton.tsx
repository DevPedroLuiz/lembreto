import { Sparkles, User as UserIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import type { AssistantActionResult } from '../../lib/assistantApi';
import type { User } from '../../types';
import { AssistantChat } from './AssistantChat';
import type { AssistantMessageAction } from './AssistantMessage';

interface AssistantFloatingButtonProps {
  currentUser: User;
  token: string | null;
  onActionComplete?: (action: AssistantActionResult) => void | Promise<void>;
  onOpenAction?: (action: AssistantMessageAction) => void | Promise<void>;
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

export function AssistantFloatingButton({
  currentUser,
  token,
  onActionComplete,
  onOpenAction,
}: AssistantFloatingButtonProps) {
  const [open, setOpen] = useState(false);
  const initials = getInitials(currentUser.name);

  return (
    <>
      <AssistantChat
        open={open}
        token={token}
        onClose={() => setOpen(false)}
        onActionComplete={onActionComplete}
        onOpenAction={onOpenAction}
        storageKey={`lembreto.lumi.conversation.${currentUser.id}`}
      />
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Abrir assistente pessoal"
        title="Abrir assistente pessoal"
        className={cn(
          'group fixed bottom-24 right-4 z-[60] h-16 w-16 rounded-full border border-white/80 bg-white p-1 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.65)] transition-all hover:-translate-y-1 hover:shadow-[0_30px_72px_-28px_rgba(37,99,235,0.8)] dark:border-white/10 dark:bg-slate-950 sm:bottom-6 sm:right-6',
          open && 'translate-y-0 shadow-[0_30px_72px_-28px_rgba(37,99,235,0.8)]',
        )}
        data-testid="assistant-floating-button"
      >
        <span className="absolute inset-0 rounded-full bg-blue-400/20 opacity-0 blur-md transition-opacity group-hover:opacity-100" />
        <span className="absolute -inset-1 rounded-full border border-blue-400/40 opacity-70 animate-pulse" />
        <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-600 to-sky-500 text-sm font-bold text-white">
          {currentUser.avatar ? (
            <img src={currentUser.avatar} alt="Avatar" className="h-full w-full object-cover" />
          ) : initials ? (
            initials
          ) : (
            <UserIcon size={23} />
          )}
        </span>
        <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-emerald-400 text-white shadow-[0_10px_24px_-12px_rgba(16,185,129,0.9)] dark:border-slate-950">
          <Sparkles size={14} />
        </span>
      </button>
    </>
  );
}
