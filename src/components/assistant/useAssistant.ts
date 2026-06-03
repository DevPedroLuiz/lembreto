import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { sendAssistantMessage, type AssistantActionResult } from '../../lib/assistantApi';
import { getAssistantMessageAction, type AssistantChatMessage } from './AssistantMessage';

const WELCOME_MESSAGE = 'Ola! Eu sou seu assistente pessoal do Lembreto. Posso revisar seus atrasados, criar lembretes com alarmes, organizar prioridades e cuidar das notificacoes para voce.';

function createMessage(
  role: AssistantChatMessage['role'],
  content: string,
  action?: AssistantChatMessage['action'],
): AssistantChatMessage {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return { id, role, content, ...(action ? { action } : {}) };
}

function inferProgressStages(message: string) {
  const normalized = message.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');

  if (/\b(atrasad|pendente|listar|ver|mostrar|consultar)\b/.test(normalized)) {
    return ['Interpretando pedido', 'Consultando lembretes', 'Organizando resposta'];
  }

  if (/\b(planejar|agenda|hoje|dia)\b/.test(normalized)) {
    return ['Interpretando pedido', 'Revisando agenda', 'Montando plano'];
  }

  if (/\b(alarme|alerta|avis|lembre|cria|comprar|fazer|marcar)\b/.test(normalized)) {
    return ['Interpretando pedido', 'Criando lembrete', 'Salvando no Lembreto'];
  }

  if (/\b(semana|resum|relatorio|progresso)\b/.test(normalized)) {
    return ['Interpretando pedido', 'Consultando semana', 'Preparando resumo'];
  }

  return ['Interpretando pedido', 'Executando acao', 'Salvando resposta'];
}

function getFriendlyAssistantError(error: unknown) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
    return error.message;
  }

  return 'Nao consegui concluir agora. Tente novamente em instantes.';
}

export function useAssistant(
  token: string | null,
  onActionComplete?: (action: AssistantActionResult) => void | Promise<void>,
  storageKey?: string,
) {
  const initialMessage = useMemo(() => createMessage('assistant', WELCOME_MESSAGE), []);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([initialMessage]);
  const [isLoading, setIsLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState('');
  const progressTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [conversationId, setConversationId] = useState<string | null>(() => {
    if (!storageKey || typeof window === 'undefined') return null;
    return window.localStorage.getItem(storageKey);
  });

  const clearProgressTimers = useCallback(() => {
    for (const timer of progressTimersRef.current) clearTimeout(timer);
    progressTimersRef.current = [];
  }, []);

  const startProgress = useCallback((message: string) => {
    clearProgressTimers();
    const stages = inferProgressStages(message);
    setProgressLabel(stages[0] ?? 'Interpretando pedido');
    progressTimersRef.current = stages.slice(1).map((stage, index) => (
      setTimeout(() => setProgressLabel(stage), 900 + index * 1200)
    ));
  }, [clearProgressTimers]);

  useEffect(() => () => clearProgressTimers(), [clearProgressTimers]);

  const startNewConversation = useCallback(() => {
    clearProgressTimers();
    setConversationId(null);
    setMessages([createMessage('assistant', WELCOME_MESSAGE)]);
    setError('');
    setProgressLabel('');
    if (storageKey && typeof window !== 'undefined') {
      window.localStorage.removeItem(storageKey);
    }
  }, [clearProgressTimers, storageKey]);

  const sendMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || isLoading) return;

    if (!token) {
      setError('Entre na sua conta para usar o assistente.');
      return;
    }

    setError('');
    setIsLoading(true);
    startProgress(message);
    setMessages((prev) => [...prev, createMessage('user', message)]);

    try {
      const response = await sendAssistantMessage({ message, conversationId, token });
      setConversationId(response.conversationId);
      if (storageKey && typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, response.conversationId);
      }
      setMessages((prev) => [
        ...prev,
        createMessage('assistant', response.message, getAssistantMessageAction(response.action)),
      ]);

      if (response.action.status === 'success' && ['create_task', 'update_task', 'create_note'].includes(response.action.type)) {
        await onActionComplete?.(response.action);
      }
    } catch (requestError) {
      if (typeof console !== 'undefined') {
        console.error('[assistant] request failed', requestError);
      }
      const messageText = getFriendlyAssistantError(requestError);
      setError(messageText);
      setMessages((prev) => [...prev, createMessage('assistant', messageText)]);
    } finally {
      clearProgressTimers();
      setProgressLabel('');
      setIsLoading(false);
    }
  }, [clearProgressTimers, conversationId, isLoading, onActionComplete, startProgress, storageKey, token]);

  return {
    messages,
    isLoading,
    progressLabel,
    error,
    conversationId,
    sendMessage,
    startNewConversation,
  };
}
