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

const assistantAvatarSrc = '/assistente-lembreto.png';

export function AssistantFloatingButton({
  currentUser,
  token,
  onActionComplete,
  onOpenAction,
}: AssistantFloatingButtonProps) {
  const [open, setOpen] = useState(false);

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
        aria-label="Abrir assistente IA do Lembreto"
        title="Abrir assistente IA do Lembreto"
        className={cn(
          'group fixed bottom-24 right-4 z-[60] h-[76px] w-[76px] overflow-visible rounded-[28px] border border-cyan-200/40 bg-slate-950/88 p-[3px] shadow-[0_18px_48px_-20px_rgba(14,165,233,0.95),0_10px_26px_-22px_rgba(0,0,0,0.9)] backdrop-blur-md transition-all duration-200 hover:-translate-y-1 hover:scale-[1.03] hover:border-cyan-100/70 hover:shadow-[0_24px_62px_-22px_rgba(14,165,233,1),0_14px_34px_-24px_rgba(0,0,0,0.95)] active:translate-y-0 sm:bottom-6 sm:right-6 sm:h-20 sm:w-20',
          open && 'scale-[1.03] border-cyan-100/75 shadow-[0_24px_62px_-22px_rgba(14,165,233,1),0_14px_34px_-24px_rgba(0,0,0,0.95)]',
        )}
        data-testid="assistant-floating-button"
      >
        <span className="pointer-events-none absolute -inset-2 rounded-[34px] bg-cyan-400/20 opacity-55 blur-xl transition-opacity duration-200 group-hover:opacity-85" />
        <span className="pointer-events-none absolute inset-0 rounded-[28px] bg-[radial-gradient(circle_at_35%_18%,rgba(103,232,249,0.42),transparent_38%),linear-gradient(145deg,rgba(14,165,233,0.42),rgba(37,99,235,0.08)_52%,rgba(2,6,23,0.35))]" />
        <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[25px] bg-slate-950">
          <img
            src={assistantAvatarSrc}
            alt="Assistente IA do Lembreto"
            className="h-full w-full scale-[1.24] object-cover object-[50%_21%] transition-transform duration-300 group-hover:scale-[1.3]"
            draggable={false}
          />
          <span className="pointer-events-none absolute inset-0 rounded-[25px] ring-1 ring-inset ring-white/16" />
          <span className="pointer-events-none absolute inset-x-2 top-1 h-5 rounded-full bg-white/18 blur-md" />
        </span>
      </button>
    </>
  );
}
