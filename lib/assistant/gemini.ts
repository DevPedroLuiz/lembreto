import { GoogleGenAI } from '@google/genai';
import type { AssistantMemoryContext } from './memory.js';
import { assistantActionSchema, type AssistantAction, type AssistantScreenshot } from './schemas.js';

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

function getFortalezaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ASSISTANT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function addFortalezaDays(days: number) {
  const current = getFortalezaDateParts();
  const date = new Date(Date.UTC(current.year, current.month - 1, current.day + days, 12, 0, 0));
  return getFortalezaDateParts(date);
}

function fortalezaIso(year: number, month: number, day: number, time: string) {
  const [hour = '09', minute = '00'] = time.split(':');
  const date = new Date(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00-03:00`,
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseLocalTime(normalized: string): string | null {
  const match = normalized.match(/\b(?:as|a|para|pra)\s+(\d{1,2})(?:h(\d{2})?|:(\d{2}))?\b|\b(\d{1,2})(?:h(\d{2})?|:(\d{2}))\b/);
  if (!match) return null;

  const hour = Number(match[1] ?? match[4]);
  const minute = match[2] || match[3] || match[5] || match[6]
    ? Number(match[2] ?? match[3] ?? match[5] ?? match[6])
    : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseLocalDueDate(normalized: string): string | null | undefined {
  const time = parseLocalTime(normalized);
  let parts: ReturnType<typeof getFortalezaDateParts> | null = null;

  if (/\bdepois de amanha\b/.test(normalized)) {
    parts = addFortalezaDays(2);
  } else if (/\bamanha\b/.test(normalized)) {
    parts = addFortalezaDays(1);
  } else if (/\bhoje\b/.test(normalized)) {
    parts = getFortalezaDateParts();
  } else {
    const dateMatch = normalized.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
    if (dateMatch) {
      const now = getFortalezaDateParts();
      const day = Number(dateMatch[1]);
      const month = Number(dateMatch[2]);
      const rawYear = dateMatch[3] ? Number(dateMatch[3]) : now.year;
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      parts = { ...now, year, month, day };
    }
  }

  if (!parts && time) {
    const now = getFortalezaDateParts();
    const candidate = fortalezaIso(now.year, now.month, now.day, time);
    if (candidate && Date.parse(candidate) > Date.now()) return candidate;
    parts = addFortalezaDays(1);
  }

  if (!parts) return undefined;
  return fortalezaIso(parts.year, parts.month, parts.day, time ?? '09:00') ?? undefined;
}

function trimTaskTitle(value: string) {
  return value
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .replace(/^(de|para)\s+/i, '')
    .trim();
}

function inferPriority(normalized: string) {
  if (/\bprioridade\s+alta\b|\burgente\b/.test(normalized)) return 'high' as const;
  if (/\bprioridade\s+baixa\b/.test(normalized)) return 'low' as const;
  if (/\bprioridade\s+media\b/.test(normalized)) return 'medium' as const;
  return undefined;
}

function extractCreateTaskTitle(message: string) {
  const cleanupTitle = (value: string) => trimTaskTitle(value
    .replace(/(hoje|amanh[ãa]|depois de amanh[ãa])/gi, '')
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, '')
    .replace(/(?:\b(?:as|a|para|pra)|[àá]s|Ã s)\s+\d{1,2}(?:h\d{0,2}|:\d{2})?\b/gi, '')
    .replace(/\bprioridade\s+(alta|m[eé]dia|baixa)\b/gi, '')
    .replace(/\burgente\b/gi, ''));
  const explicitTitle = message.match(/\bt[ií]tulo\s+(.+)$/i)?.[1];
  if (explicitTitle) return cleanupTitle(explicitTitle);

  return cleanupTitle(message
    .replace(/^(?:por favor[, ]*)?(?:me\s+)?(?:lembre|lembra|crie|criar|adicione|adicionar|coloque|agenda|agendar)\s+(?:um\s+)?(?:lembrete\s+)?(?:de|para)?\s*/i, '')
    .replace(/^(?:para\s+)?(?:eu|voce|você)\s+/i, ''));
}

function extractCompleteTaskSearch(message: string) {
  return trimTaskTitle(message
    .replace(/^(?:por favor[, ]*)?/i, '')
    .replace(/\b(concluir|conclui|conclua|finalizar|finaliza|marcar|marca|feito)\b/gi, '')
    .replace(/\b(como\s+)?conclu[ií]do\b/gi, '')
    .replace(/\b(lembrete|tarefa|esse|essa|este|esta|ultimo|ultima|primeiro|primeira)\b/gi, ''));
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

function normalizePriorityValue(value: unknown) {
  const priority = pickString(value);
  if (!priority) return undefined;
  const normalized = normalizeTextForIntent(priority);
  if (normalized === 'high' || normalized === 'alta' || normalized === 'urgente' || normalized === 'importante') {
    return 'high';
  }
  if (normalized === 'low' || normalized === 'baixa') return 'low';
  if (normalized === 'medium' || normalized === 'media' || normalized === 'medio' || normalized === 'normal') {
    return 'medium';
  }
  return undefined;
}

function normalizeDateLikeValue(value: unknown) {
  if (value === null) return null;
  const date = pickString(value);
  if (!date) return undefined;
  return Number.isNaN(Date.parse(date)) ? undefined : date;
}

function normalizeActionType(value: unknown) {
  const type = pickString(value);
  if (!type) return undefined;
  const normalized = type.toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    add_task: 'create_task',
    create_reminder: 'create_task',
    add_reminder: 'create_task',
    reminder: 'create_task',
    task: 'create_task',
    create_task_from_image: 'create_task',
    create_task_from_screenshot: 'create_task',
    screenshot_to_task: 'create_task',
    image_to_task: 'create_task',
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
    ask_confirmation: 'needs_confirmation',
    clarification: 'needs_confirmation',
    need_confirmation: 'needs_confirmation',
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
    const title =
      pickString(payload.title) ??
      pickString(payload.name) ??
      (isRecord(payload.task) ? pickString(payload.task.title) : undefined) ??
      (isRecord(payload.reminder) ? pickString(payload.reminder.title) : undefined);
    const description =
      typeof payload.description === 'string'
        ? payload.description
        : typeof payload.details === 'string'
          ? payload.details
          : typeof payload.summary === 'string'
            ? payload.summary
            : undefined;
    const dueDate = normalizeDateLikeValue(payload.dueDate ?? payload.date ?? payload.datetime ?? payload.deadline);
    const endDate = normalizeDateLikeValue(payload.endDate ?? payload.end);
    const priority = normalizePriorityValue(payload.priority);

    return {
      ...(title ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(endDate !== undefined ? { endDate } : {}),
      ...(priority ? { priority } : {}),
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

function inferActionTypeFromRecord(value: Record<string, unknown>) {
  const payload = isRecord(value.payload) ? value.payload : value;
  if (
    pickString(payload.title) ||
    pickString(payload.name) ||
    (isRecord(payload.task) && pickString(payload.task.title)) ||
    (isRecord(payload.reminder) && pickString(payload.reminder.title))
  ) {
    return 'create_task';
  }
  if (pickString(payload.question)) return 'needs_confirmation';
  if (pickString(payload.answer) || pickString(payload.message)) return 'answer_only';
  return undefined;
}

function normalizeAssistantAction(value: unknown) {
  if (Array.isArray(value)) return normalizeAssistantAction(value[0]);
  if (!isRecord(value)) return value;

  const actionObject = isRecord(value.action) ? value.action : value;
  const type = normalizeActionType(actionObject.type ?? value.type ?? value.action ?? value.intent)
    ?? inferActionTypeFromRecord(actionObject)
    ?? inferActionTypeFromRecord(value);
  if (!type) return value;
  const rawPayload = isRecord(actionObject.payload)
    ? actionObject.payload
    : isRecord(value.payload)
      ? value.payload
      : actionObject;
  const payload = normalizePayload(type, rawPayload);
  return {
    type,
    payload,
    confirmationMessage: pickString(actionObject.confirmationMessage) ??
      pickString(value.confirmationMessage) ??
      pickString(actionObject.message) ??
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

function parseImageDataUrl(imageDataUrl: string) {
  const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
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
    if (/\b(listar|lista|mostrar|mostra|ver|consultar|consulta)\b/.test(normalized)) {
      if (/\b(concluid[oa]s?|finalizad[oa]s?)\b/.test(normalized)) {
        return {
          type: 'list_tasks',
          payload: { status: 'completed' },
          confirmationMessage: 'Consultei seus lembretes concluidos.',
        };
      }

      if (/\b(pendente|pendentes|aberto|abertos)\b/.test(normalized)) {
        return {
          type: 'list_tasks',
          payload: { status: 'pending' },
          confirmationMessage: 'Consultei seus lembretes pendentes.',
        };
      }
    }

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

    if (/\b(concluir|conclui|conclua|finalizar|finaliza|marcar como concluido|feito)\b/.test(normalized)) {
      const shouldUseContext = /\b(esse|essa|este|esta|ultimo|ultima|ele|ela)\b/.test(normalized);
      const search = extractCompleteTaskSearch(message);
      return {
        type: 'update_task',
        payload: {
          ...(shouldUseContext || !search ? { contextRef: 'last_relevant_task' as const } : { search }),
          updates: { status: 'completed' as const },
        },
        confirmationMessage: 'Pronto, marquei o lembrete como concluido.',
      };
    }

    if (/\b(lembre|lembra|crie|criar|adicione|adicionar|coloque|agenda|agendar)\b/.test(normalized)) {
      const title = extractCreateTaskTitle(message);
      if (title) {
        const dueDate = parseLocalDueDate(normalized);
        const priority = inferPriority(normalized);

        return {
          type: 'create_task',
          payload: {
            title,
            ...(dueDate !== undefined ? { dueDate } : {}),
            ...(priority ? { priority } : {}),
            alarmEnabled: Boolean(dueDate && parseLocalTime(normalized)),
          },
          confirmationMessage: `Pronto, criei o lembrete "${title}".`,
        };
      }
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

export async function interpretAssistantScreenshot(
  input: AssistantScreenshot,
  memoryContext?: AssistantMemoryContext,
): Promise<AssistantAction> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AssistantUnavailableError();

  const image = parseImageDataUrl(input.imageDataUrl);
  if (!image) throw new AssistantInvalidModelResponseError();

  const configuredModel = process.env.GEMINI_MODEL?.trim();
  const models = Array.from(new Set([configuredModel, FALLBACK_MODEL].filter(Boolean))) as string[];
  const ai = new GoogleGenAI({ apiKey });
  const instruction = [
    'Analise a captura de tela do navegador e crie uma acao do Lembreto.',
    'Prioridade: transformar informacoes visiveis em um lembrete util para o usuario.',
    'Se houver uma data, horario, prazo, reuniao, pagamento, compromisso, entrega ou follow-up visivel, extraia esses dados.',
    'Se nao houver data clara, voce pode criar um lembrete sem prazo quando o item ainda for acionavel.',
    'Inclua no description um resumo curto do que foi lido na captura e, se existir, a URL da pagina.',
    'Se a imagem nao tiver informacao suficiente para um lembrete, retorne needs_confirmation com uma pergunta objetiva.',
    'Nunca invente dados que nao aparecem na captura ou no contexto enviado.',
    'Use somente priority em ingles: low, medium ou high.',
    'Use somente datas ISO 8601 validas em dueDate/endDate; se a data estiver ambigua, omita dueDate.',
    'Formato esperado para criar lembrete: {"type":"create_task","payload":{"title":"...","description":"...","dueDate":null,"priority":"medium","category":"Geral","tags":["Print IA"],"alarmEnabled":false},"confirmationMessage":"Pronto, criei o lembrete ..."}',
    'Formato esperado quando faltar informacao: {"type":"needs_confirmation","payload":{"question":"Qual data devo usar para esse lembrete?"},"confirmationMessage":"Preciso de mais uma informacao para continuar."}',
  ].join('\n');
  const metadata = {
    pageTitle: input.pageTitle ?? '',
    pageUrl: input.pageUrl ?? '',
    userInstruction: input.instruction ?? '',
    memory: memoryContext ?? {
      recentMessages: [],
      recentActions: [],
      contextRefs: {},
    },
  };

  let receivedInvalidModelResponse = false;
  let lastError: unknown;
  for (const model of models) {
    try {
      const controller = new AbortController();
      const response = await withModelTimeout(
        model,
        ai.models.generateContent({
          model,
          contents: [
            { text: `${instruction}\n\nContexto:\n${JSON.stringify(metadata)}` },
            { inlineData: image },
          ],
          config: {
            abortSignal: controller.signal,
            httpOptions: { timeout: MODEL_REQUEST_TIMEOUT_MS },
            systemInstruction: buildSystemPrompt(),
            temperature: 0.15,
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
        console.warn('[assistant] invalid screenshot response from model', { model });
      }
      receivedInvalidModelResponse = true;
    } catch (error) {
      if (process.env.ASSISTANT_DEBUG_MODEL_RESPONSE === 'true') {
        console.warn('[assistant] screenshot model request failed', {
          model,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      lastError = error;
    }
  }

  if (receivedInvalidModelResponse) {
    return assistantActionSchema.parse({
      type: 'needs_confirmation',
      payload: {
        question: 'Nao consegui transformar esse print em um lembrete com seguranca. Escreva uma instrucao curta, por exemplo: "me lembre de responder esse e-mail amanha".',
      },
      confirmationMessage: 'Preciso de uma instrucao curta para criar o lembrete a partir do print.',
    });
  }
  throw new AssistantModelRequestError(lastError);
}
