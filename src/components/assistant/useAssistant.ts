import { useCallback, useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import { sendAssistantMessage } from '../../lib/assistantApi';
import type { AssistantChatMessage } from './AssistantMessage';

const WELCOME_MESSAGE = 'Ola! Eu sou seu assistente pessoal do Lembreto. Posso revisar seus atrasados, criar lembretes com alarmes, organizar prioridades e cuidar das notificacoes para voce.';

function createMessage(role: AssistantChatMessage['role'], content: string): AssistantChatMessage {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return { id, role, content };
}

export function useAssistant(
  token: string | null,
  onActionComplete?: (actionType: string) => void | Promise<void>,
  storageKey?: string,
) {
  const initialMessage = useMemo(() => createMessage('assistant', WELCOME_MESSAGE), []);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([initialMessage]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(() => {
    if (!storageKey || typeof window === 'undefined') return null;
    return window.localStorage.getItem(storageKey);
  });

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setMessages([createMessage('assistant', WELCOME_MESSAGE)]);
    setError('');
    if (storageKey && typeof window !== 'undefined') {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  const sendMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || isLoading) return;

    if (!token) {
      setError('Entre na sua conta para usar o assistente.');
      return;
    }

    setError('');
    setIsLoading(true);
    setMessages((prev) => [...prev, createMessage('user', message)]);

    try {
      const response = await sendAssistantMessage({ message, conversationId, token });
      setConversationId(response.conversationId);
      if (storageKey && typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, response.conversationId);
      }
      setMessages((prev) => [...prev, createMessage('assistant', response.message)]);

      if (['create_task', 'update_task', 'create_note'].includes(response.action.type)) {
        await onActionComplete?.(response.action.type);
      }
    } catch (requestError) {
      const messageText = requestError instanceof ApiError
        ? requestError.message
        : 'Nao consegui falar com o assistente agora. Tente novamente em instantes.';
      setError(messageText);
      setMessages((prev) => [...prev, createMessage('assistant', messageText)]);
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, isLoading, onActionComplete, storageKey, token]);

  return {
    messages,
    isLoading,
    error,
    conversationId,
    sendMessage,
    startNewConversation,
  };
}
