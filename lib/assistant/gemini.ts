import { GoogleGenAI } from '@google/genai';
import type { AssistantMemoryContext } from './memory.js';
import { assistantActionSchema, type AssistantAction } from './schemas.js';

export const ASSISTANT_TIMEZONE = 'America/Fortaleza';

const FALLBACK_MODEL = 'gemini-2.5-flash';

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

export async function interpretAssistantMessage(
  message: string,
  memoryContext?: AssistantMemoryContext,
): Promise<AssistantAction> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AssistantUnavailableError();

  const configuredModel = process.env.GEMINI_MODEL?.trim();
  const models = Array.from(new Set([configuredModel, FALLBACK_MODEL].filter(Boolean))) as string[];
  const ai = new GoogleGenAI({ apiKey });

  let text: string | undefined;
  let lastError: unknown;
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
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
          systemInstruction: buildSystemPrompt(),
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      });
      text = response.text;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!text) {
    if (lastError) throw new AssistantModelRequestError(lastError);
    throw new AssistantInvalidModelResponseError();
  }

  try {
    const parsed = JSON.parse(extractJson(text)) as unknown;
    return assistantActionSchema.parse(parsed);
  } catch {
    throw new AssistantInvalidModelResponseError();
  }
}
