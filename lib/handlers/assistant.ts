import { randomUUID } from 'node:crypto';
import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../auth.js';
import { logError, logInfo, logWarn } from '../logger.js';
import { formatZodError } from '../schemas.js';
import {
  AssistantInvalidModelResponseError,
  AssistantModelRequestError,
  AssistantUnavailableError,
  interpretAssistantMessage,
} from '../assistant/gemini.js';
import {
  AssistantConversationAccessError,
  buildAssistantMemoryContext,
  ensureAssistantConversation,
  saveAssistantMessage,
} from '../assistant/memory.js';
import { assistantMessageSchema, assistantResponseSchema } from '../assistant/schemas.js';
import { executeAssistantAction } from '../assistant/tools.js';
import {
  type HandlerContext,
  type HandlerResult,
  getRequestMeta,
  json,
  methodNotAllowed,
} from './core.js';

const EMPTY_ASSISTANT_MEMORY = {
  recentMessages: [],
  recentActions: [],
  contextRefs: {},
};

function isAssistantMemoryInfrastructureError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : '';
  const code = 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';
  return code === '42P01' || /assistant_(conversations|messages|action_events|context_refs)/i.test(message);
}

async function requireAssistantAuth(context: HandlerContext) {
  try {
    return await requireAuthFromAuthorizationHeader(
      context.sql,
      context.request.headers.authorization as string | undefined,
    );
  } catch (error) {
    const authFailure = getAuthFailureResponse(error);
    if (authFailure) {
      return json(authFailure.status, { error: authFailure.error });
    }

    logError('assistant_auth_failed', error, getRequestMeta(context.request));
    return json(500, { error: 'Erro interno ao autenticar' });
  }
}

export async function handleAssistantMessage(context: HandlerContext): Promise<HandlerResult> {
  if (context.request.method !== 'POST') return methodNotAllowed();

  const auth = await requireAssistantAuth(context);
  if ('status' in auth) return auth;

  const parsed = assistantMessageSchema.safeParse(context.request.body ?? {});
  if (!parsed.success) {
    return json(400, { error: formatZodError(parsed.error) });
  }

  try {
    let memoryEnabled = true;
    let conversation = { id: parsed.data.conversationId ?? randomUUID(), userId: auth.user.id };
    let userMessage: { id: string } | null = null;

    try {
      conversation = await ensureAssistantConversation(
        context.sql,
        auth.user.id,
        parsed.data.conversationId,
      );
      userMessage = await saveAssistantMessage(context.sql, {
        conversationId: conversation.id,
        userId: auth.user.id,
        role: 'user',
        content: parsed.data.message,
        metadata: {},
      });
    } catch (error) {
      if (error instanceof AssistantConversationAccessError) throw error;
      if (!isAssistantMemoryInfrastructureError(error)) throw error;

      memoryEnabled = false;
      logWarn('assistant_memory_unavailable', getRequestMeta(context.request, {
        userId: auth.user.id,
      }));
    }

    const memoryContext = memoryEnabled
      ? await buildAssistantMemoryContext(context.sql, {
          userId: auth.user.id,
          conversationId: conversation.id,
        }).catch((error) => {
          if (!isAssistantMemoryInfrastructureError(error)) throw error;
          memoryEnabled = false;
          logWarn('assistant_memory_context_unavailable', getRequestMeta(context.request, {
            userId: auth.user.id,
            conversationId: conversation.id,
          }));
          return EMPTY_ASSISTANT_MEMORY;
        })
      : EMPTY_ASSISTANT_MEMORY;
    const action = await interpretAssistantMessage(parsed.data.message, memoryContext);
    const execution = await executeAssistantAction(context, action, {
      ...(memoryEnabled
        ? {
            userId: auth.user.id,
            conversationId: conversation.id,
            messageId: userMessage?.id,
          }
        : {}),
    });

    if (memoryEnabled) {
      await saveAssistantMessage(context.sql, {
        conversationId: conversation.id,
        userId: auth.user.id,
        role: 'assistant',
        content: execution.message,
        metadata: {
          action: execution.action,
          references: execution.references ?? {},
        },
      }).catch((error) => {
        if (!isAssistantMemoryInfrastructureError(error)) throw error;
        logWarn('assistant_memory_save_response_unavailable', getRequestMeta(context.request, {
          userId: auth.user.id,
          conversationId: conversation.id,
        }));
      });
    }
    const safeResponse = assistantResponseSchema.parse({
      conversationId: conversation.id,
      message: execution.message,
      action: {
        type: execution.action.type,
        status: execution.action.status,
        ...(execution.action.entityType ? { entityType: execution.action.entityType } : {}),
        ...(execution.action.entityId ? { entityId: execution.action.entityId } : {}),
        ...(execution.action.entityTitle ? { entityTitle: execution.action.entityTitle } : {}),
      },
      ...(execution.references ? { references: execution.references } : {}),
    });

    logInfo('assistant_action_executed', getRequestMeta(context.request, {
      userId: auth.user.id,
      conversationId: conversation.id,
      actionType: safeResponse.action.type,
      actionStatus: safeResponse.action.status,
    }));

    return json(200, safeResponse);
  } catch (error) {
    if (error instanceof AssistantConversationAccessError) {
      return json(403, { error: error.message });
    }

    if (
      error instanceof AssistantUnavailableError ||
      error instanceof AssistantInvalidModelResponseError ||
      error instanceof AssistantModelRequestError
    ) {
      return json(503, { error: error.message });
    }

    logError('assistant_message_failed', error, getRequestMeta(context.request, { userId: auth.user.id }));
    return json(500, {
      error: 'O assistente nao conseguiu concluir o pedido agora. Tente novamente em instantes.',
    });
  }
}
