import { FormEvent, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Plus, Send, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/cn';
import { AssistantMessage } from './AssistantMessage';
import { useAssistant } from './useAssistant';

type SpeechRecognitionConstructor = new () => SpeechRecognition;

interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

interface SpeechRecognitionEvent {
  results: {
    length: number;
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface AssistantChatProps {
  open: boolean;
  token: string | null;
  onClose: () => void;
  onActionComplete?: (actionType: string) => void | Promise<void>;
  storageKey?: string;
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

export function AssistantChat({ open, token, onClose, onActionComplete, storageKey }: AssistantChatProps) {
  const [input, setInput] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const { messages, isLoading, error, sendMessage, startNewConversation } = useAssistant(token, onActionComplete, storageKey);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, open]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextMessage = input.trim();
    if (!nextMessage) return;
    setInput('');
    await sendMessage(nextMessage);
  };

  const startVoiceInput = () => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setVoiceError('Seu navegador nao oferece suporte a entrada por voz. Voce ainda pode digitar sua mensagem.');
      return;
    }

    setVoiceError('');
    const recognition = new Recognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length })
        .map((_, index) => event.results[index]?.[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (transcript) setInput((prev) => `${prev}${prev ? ' ' : ''}${transcript}`.trim());
    };
    recognition.onerror = () => {
      setVoiceError('Nao consegui capturar sua voz agora. Tente novamente ou digite sua mensagem.');
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-x-3 bottom-24 z-[90] mx-auto flex max-h-[calc(100dvh-8rem)] max-w-[420px] flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 shadow-[0_34px_90px_-34px_rgba(15,23,42,0.65)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95 sm:inset-x-auto sm:right-6 sm:bottom-24 sm:h-[620px] sm:w-[420px]"
          data-testid="assistant-chat"
          role="dialog"
          aria-label="Assistente do Lembreto"
        >
          <header className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-300">
                Assistente
              </p>
              <h2 className="truncate text-base font-semibold text-slate-950 dark:text-white">
                Lembreto
              </h2>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={startNewConversation}
                aria-label="Nova conversa"
                title="Nova conversa"
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-2xl px-3 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                data-testid="assistant-new-conversation-button"
              >
                <Plus size={15} />
                Nova
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar assistente"
                className="icon-slot h-10 w-10 rounded-2xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
              >
                <X size={19} />
              </button>
            </div>
          </header>

          <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((message) => (
              <AssistantMessage key={message.id} message={message} />
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                <Loader2 className="animate-spin" size={16} />
                Pensando...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-slate-200/80 p-3 dark:border-white/10">
            {(voiceError || error || isListening) && (
              <p
                className={cn(
                  'mb-2 rounded-2xl px-3 py-2 text-xs font-medium',
                  isListening
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
                )}
              >
                {isListening ? 'Ouvindo...' : voiceError || error}
              </p>
            )}
            <form onSubmit={submit} className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Digite sua mensagem..."
                rows={1}
                maxLength={1200}
                className="field-control min-h-12 max-h-28 flex-1 resize-none rounded-2xl py-3"
                data-testid="assistant-input"
              />
              <button
                type="button"
                onClick={startVoiceInput}
                disabled={isLoading || isListening}
                aria-label="Usar microfone"
                title="Usar microfone"
                className="icon-slot h-12 w-12 rounded-2xl border border-slate-200 bg-white text-slate-600 transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:border-blue-500/30 dark:hover:text-blue-300"
                data-testid="assistant-microphone-button"
              >
                <Mic size={19} />
              </button>
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                aria-label="Enviar mensagem"
                title="Enviar mensagem"
                className="icon-slot h-12 w-12 rounded-2xl bg-blue-600 text-white shadow-[0_18px_34px_-22px_rgba(37,99,235,0.8)] transition-all hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="assistant-send-button"
              >
                {isLoading ? <Loader2 className="animate-spin" size={19} /> : <Send size={19} />}
              </button>
            </form>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
