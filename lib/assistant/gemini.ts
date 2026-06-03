import { GoogleGenAI } from '@google/genai';
import type { AssistantMemoryContext } from './memory.js';
import { assistantActionSchema, type AssistantAction } from './schemas.js';

export const ASSISTANT_TIMEZONE = 'America/Fortaleza';

const FALLBACK_MODEL = 'gemini-2.5-flash';
const MODEL_REQUEST_TIMEOUT_MS = 18000;
const MAX_MODEL_OUTPUT_TOKENS = 700;

function getFortalezaNow() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: ASSISTANT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

function buildSystemPrompt() {
  return [
    'Voce e a Lumi, assistente pessoal inteligente do sistema Lembreto.',
    'Sua funcao e ajudar o usuario a organizar tarefas, lembretes, notificacoes, notas e rotina.',
    'Aja como um assistente pessoal proativo: quando concluir algo, indique o proximo passo util sem esperar o usuario pedir.',
    'Use o Lembreto como ferramenta de trabalho: crie, consulte, atualize e organize informacoes do usuario dentro do sistema.',
    'Voce nao executa acoes fora do sistema.',
    'Voce pode usar o historico recente da conversa e as referencias contextuais para entender comandos incompletos.',
    'Use o contexto para resolver expressoes como: "esse lembrete", "ele", "essa tarefa", "o primeiro", "o ultimo", "aquela nota", "muda para amanha" e "confirma".',
    'Nunca invente uma referencia.',
    'Se houver mais de uma possibilidade, retorne needs_confirmation.',
    'Se o usuario disser "o primeiro", use a primeira entidade da ultima lista de lembretes retornada.',
    'Se o usuario disser "esse lembrete" apos criar ou consultar um lembrete, use o ultimo lembrete relevante.',
    'Se o usuario pedir "muda para amanha" e houver um ultimo lembrete ativo no contexto, gere uma acao update_task.',
    'Se nao houver contexto suficiente, peca confirmacao.',
    'Responda sempre em JSON valido.',
    'Quando o usuario pedir para criar um lembrete, extraia titulo, data, hora, prioridade, categoria e tags.',
    'Quando o usuario falar de avisos, alertas, alarmes ou central de notificacoes, use as acoes de notificacoes.',
    'Ao criar lembretes com data/hora, habilite alarmEnabled quando fizer sentido avisar o usuario.',
    `Use o timezone ${ASSISTANT_TIMEZONE}.`,
    `Data e hora atuais em ${ASSISTANT_TIMEZONE}: ${getFortalezaNow()}.`,
    'Quando faltar informacao essencial, retorne needs_confirmation.',
    'Nao invente datas se estiver ambiguo.',
    'Nunca retorne texto fora do JSON.',
    'Nao gere SQL, codigo, scripts ou comandos.',
    'Retorne exatamente um objeto no formato de uma das acoes permitidas.',
    '',
    'Acoes permitidas:',
    '- create_task: cria lembrete/tarefa.',
    '- list_tasks: consulta lembretes.',
    '- update_task: atualiza ou conclui lembrete; use search se nao souber o ID.',
    '  Para referencias contextuais em update_task, use payload.contextRef com last_created_task, last_updated_task, last_relevant_task, last_listed_task_first ou last_listed_task_last.',
    '- list_notifications: consulta notificacoes recentes, pendentes ou lidas.',
    '- manage_notifications: processa notificacoes vencidas, marca como lidas, limpa a central ou ativa/desativa notificacoes.',
    '- assistant_brief: gera plano autonomo do dia, resumo de atrasados ou resumo semanal com base nos dados reais do Lembreto.',
    '- create_note: cria nota.',
    '- answer_only: responde orientacoes de rotina sem executar acao.',
    '- needs_confirmation: pede dado essencial que esta faltando.',
    '',
    'Formato de datas: ISO 8601 com offset, preferencialmente -03:00 para America/Fortaleza.',
    'Para recorrencia, preencha payload.recurrence. Se nao houver suporte nativo, o sistema criara o proximo lembrete possivel.',
  ].join('\n');
}

function extractJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function pickString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function pickStringOrNull(value: unknown) {
  if (value === null) return null;
  return pickString(value);
}

function pickBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function pickNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function pickStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : undefined;
}

function normalizeActionType(value: unknown) {
  const type = pickString(value);
  if (!type) return undefined;
  const normalized = type.toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    add_task: 'create_task',
    create_reminder: 'create_task',
    add_reminder: 'create_task',
    list_reminders: 'list_tasks',
    list_tasks: 'list_tasks',
    update_reminder: 'update_task',
    complete_task: 'update_task',
    create_notification: 'manage_notifications',
    list_alerts: 'list_notifications',
    list_notifications: 'list_notifications',
    manage_alerts: 'manage_notifications',
    manage_notifications: 'manage_notifications',
    plan_day: 'assistant_brief',
    daily_plan: 'assistant_brief',
    weekly_summary: 'assistant_brief',
    overdue_summary: 'assistant_brief',
  };
  return aliases[normalized] ?? normalized;
}

function defaultConfirmationMessage(type: string, payload: Record<string, unknown>) {
  const title = pickString(payload.title) ?? 'Lembrete';
  if (type === 'create_task') return `Pronto, criei o lembrete "${title}".`;
  if (type === 'list_tasks') return 'Consultei seus lembretes.';
  if (type === 'update_task') return 'Pronto, atualizei o lembrete.';
  if (type === 'create_note') return `Pronto, criei a nota "${title}".`;
  if (type === 'list_notifications') return 'Consultei suas notificacoes.';
  if (type === 'manage_notifications') return 'Pronto, organizei suas notificacoes.';
  if (type === 'assistant_brief') return 'Preparei uma visao inteligente para voce.';
  if (type === 'needs_confirmation') return pickString(payload.question) ?? 'Preciso de mais uma informacao para continuar.';
  return pickString(payload.answer) ?? 'Certo, vou te ajudar com isso.';
}

function normalizePayload(type: string, payload: Record<string, unknown>) {
  if (type === 'create_task') {
    return {
      ...(pickString(payload.title) ? { title: pickString(payload.title) } : {}),
      ...(typeof payload.description === 'string' ? { description: payload.description } : {}),
      ...(payload.dueDate !== undefined || payload.date !== undefined
        ? { dueDate: pickStringOrNull(payload.dueDate ?? payload.date) }
        : {}),
      ...(payload.endDate !== undefined ? { endDate: pickStringOrNull(payload.endDate) } : {}),
      ...(pickString(payload.priority) ? { priority: pickString(payload.priority) } : {}),
      ...(pickString(payload.category) ? { category: pickString(payload.category) } : {}),
      ...(pickStringArray(payload.tags) ? { tags: pickStringArray(payload.tags) } : {}),
      ...(pickBoolean(payload.alarmEnabled) !== undefined ? { alarmEnabled: pickBoolean(payload.alarmEnabled) } : {}),
      ...(pickNumber(payload.noTimeReminderMinutes) !== undefined
        ? { noTimeReminderMinutes: pickNumber(payload.noTimeReminderMinutes) }
        : {}),
      ...(isRecord(payload.recurrence) ? { recurrence: payload.recurrence } : {}),
    };
  }

  if (type === 'list_tasks') {
    return {
      ...(pickString(payload.status) ? { status: pickString(payload.status) } : {}),
      ...(payload.from !== undefined ? { from: pickStringOrNull(payload.from) } : {}),
      ...(payload.to !== undefined ? { to: pickStringOrNull(payload.to) } : {}),
      ...(payload.search !== undefined ? { search: pickStringOrNull(payload.search) } : {}),
    };
  }

  if (type === 'update_task') {
    return {
      ...(pickString(payload.taskId) ? { taskId: pickString(payload.taskId) } : {}),
      ...(pickString(payload.search) ? { search: pickString(payload.search) } : {}),
      ...(pickString(payload.contextRef) ? { contextRef: pickString(payload.contextRef) } : {}),
      updates: isRecord(payload.updates) ? payload.updates : {},
    };
  }

  if (type === 'create_note') {
    return {
      ...(pickString(payload.title) ? { title: pickString(payload.title) } : {}),
      ...(typeof payload.content === 'string' ? { content: payload.content } : {}),
      ...(pickString(payload.category) ? { category: pickString(payload.category) } : {}),
      ...(pickStringArray(payload.tags) ? { tags: pickStringArray(payload.tags) } : {}),
    };
  }

  if (type === 'list_notifications') {
    return {
      ...(pickString(payload.read) ? { read: pickString(payload.read) } : {}),
      ...(pickString(payload.kind) ? { kind: pickString(payload.kind) } : {}),
      ...(pickNumber(payload.limit) !== undefined ? { limit: pickNumber(payload.limit) } : {}),
    };
  }

  if (type === 'manage_notifications') {
    return {
      action: pickString(payload.action) ?? pickString(payload.operation) ?? 'process_due',
    };
  }

  if (type === 'assistant_brief') {
    const rawMode = pickString(payload.mode) ?? pickString(payload.period) ?? pickString(payload.view);
    const normalizedMode = rawMode?.toLowerCase().replace(/[\s-]+/g, '_');
    const mode = normalizedMode === 'week' || normalizedMode === 'weekly' || normalizedMode === 'semana'
      ? 'week'
      : normalizedMode === 'overdue' || normalizedMode === 'atrasados'
        ? 'overdue'
        : 'today';
    return { mode };
  }

  if (type === 'needs_confirmation') {
    return {
      question: pickString(payload.question) ?? 'Preciso de mais uma informacao para continuar.',
      ...(payload.draftAction !== undefined ? { draftAction: payload.draftAction } : {}),
    };
  }

  if (type === 'answer_only') {
    return {
      answer: pickString(payload.answer) ?? pickString(payload.message) ?? 'Posso te ajudar a organizar isso no Lembreto.',
    };
  }

  return payload;
}

function normalizeAssistantAction(value: unknown) {
  if (!isRecord(value)) return value;
  const type = normalizeActionType(value.type ?? value.action ?? value.intent);
  if (!type) return value;
  const rawPayload = isRecord(value.payload) ? value.payload : value;
  const payload = normalizePayload(type, rawPayload);
  return {
    type,
    payload,
    confirmationMessage: pickString(value.confirmationMessage) ??
      pickString(value.message) ??
      defaultConfirmationMessage(type, rawPayload),
  };
}

export class AssistantUnavailableError extends Error {
  constructor() {
    super('O assistente esta indisponivel no momento. Configure a variavel GEMINI_API_KEY para ativar o Gemini.');
  }
}

export class AssistantInvalidModelResponseError extends Error {
  constructor() {
    super('Nao consegui interpretar a resposta do assistente. Tente reformular sua mensagem.');
  }
}

export class AssistantModelRequestError extends Error {
  cause?: unknown;

  constructor(cause?: unknown) {
    super('O assistente nao conseguiu falar com a IA agora. Verifique a chave/modelo do Gemini e tente novamente.');
    this.cause = cause;
  }
}

function parseAssistantAction(text: string): AssistantAction | null {
  try {
    const parsed = JSON.parse(extractJson(text)) as unknown;
    return assistantActionSchema.parse(normalizeAssistantAction(parsed));
  } catch (error) {
    if (process.env.ASSISTANT_DEBUG_MODEL_RESPONSE === 'true') {
      console.warn('[assistant] invalid model response', {
        error: error instanceof Error ? error.message : String(error),
        text,
      });
    }
    return null;
  }
}

function withModelTimeout<T>(model: string, promise: Promise<T>, controller: AbortController): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`assistant_model_timeout:${model}`));
    }, MODEL_REQUEST_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function normalizeTextForIntent(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

export function interpretLocalAssistantMessage(message: string): AssistantAction | null {
  const normalized = normalizeTextForIntent(message);

  const action = (() => {
    if (/\b(atrasad[oa]s?|vencid[oa]s?)\b/.test(normalized)) {
      return {
        type: 'assistant_brief',
        payload: { mode: 'overdue' },
        confirmationMessage: 'Revisei seus lembretes atrasados.',
      };
    }

    if (/\b(resum[aoir]*|balanco|relatorio)\b/.test(normalized) && /\b(semana|semanal|7 dias)\b/.test(normalized)) {
      return {
        type: 'assistant_brief',
        payload: { mode: 'week' },
        confirmationMessage: 'Preparei um resumo da sua semana.',
      };
    }

    if (
      /\b(planej[aeio]|organiza|prioriza|agenda)\b/.test(normalized) &&
      /\b(hoje|dia|rotina)\b/.test(normalized)
    ) {
      return {
        type: 'assistant_brief',
        payload: { mode: 'today' },
        confirmationMessage: 'Preparei um plano para hoje.',
      };
    }

    return null;
  })();

  if (!action) return null;
  return assistantActionSchema.parse(action);
}

export async function interpretAssistantMessage(
  message: string,
  memoryContext?: AssistantMemoryContext,
): Promise<AssistantAction> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AssistantUnavailableError();

  const configuredModel = process.env.GEMINI_MODEL?.trim();
  const models = Array.from(new Set([configuredModel, FALLBACK_MODEL].filter(Boolean))) as string[];
  const ai = new GoogleGenAI({ apiKey });

  let receivedInvalidModelResponse = false;
  let lastError: unknown;
  for (const model of models) {
    try {
      const controller = new AbortController();
      const response = await withModelTimeout(
        model,
        ai.models.generateContent({
          model,
          contents: JSON.stringify({
            currentMessage: message,
            memory: memoryContext ?? {
              recentMessages: [],
              recentActions: [],
              contextRefs: {},
            },
          }),
          config: {
            abortSignal: controller.signal,
            httpOptions: { timeout: MODEL_REQUEST_TIMEOUT_MS },
            systemInstruction: buildSystemPrompt(),
            temperature: 0.2,
            maxOutputTokens: MAX_MODEL_OUTPUT_TOKENS,
            responseMimeType: 'application/json',
          },
        }),
        controller,
      );
      if (!response.text) {
        receivedInvalidModelResponse = true;
        continue;
      }

      const action = parseAssistantAction(response.text);
      if (action) return action;
      if (process.env.ASSISTANT_DEBUG_MODEL_RESPONSE === 'true') {
        console.warn('[assistant] invalid response from model', { model });
      }
      receivedInvalidModelResponse = true;
    } catch (error) {
      if (process.env.ASSISTANT_DEBUG_MODEL_RESPONSE === 'true') {
        console.warn('[assistant] model request failed', {
          model,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      lastError = error;
    }
  }

  if (receivedInvalidModelResponse) throw new AssistantInvalidModelResponseError();
  throw new AssistantModelRequestError(lastError);
}
