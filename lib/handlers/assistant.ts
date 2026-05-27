import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../auth.js';
import { logError, logInfo } from '../logger.js';
import { formatZodError } from '../schemas.js';
import {
  AssistantInvalidModelResponseError,
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
    const conversation = await ensureAssistantConversation(
      context.sql,
      auth.user.id,
      parsed.data.conversationId,
    );
    const userMessage = await saveAssistantMessage(context.sql, {
      conversationId: conversation.id,
      userId: auth.user.id,
      role: 'user',
      content: parsed.data.message,
      metadata: {},
    });
    const memoryContext = await buildAssistantMemoryContext(context.sql, {
      userId: auth.user.id,
      conversationId: conversation.id,
    });
    const action = await interpretAssistantMessage(parsed.data.message, memoryContext);
    const execution = await executeAssistantAction(context, action, {
      userId: auth.user.id,
      conversationId: conversation.id,
      messageId: userMessage.id,
    });
    await saveAssistantMessage(context.sql, {
      conversationId: conversation.id,
      userId: auth.user.id,
      role: 'assistant',
      content: execution.message,
      metadata: {
        action: execution.action,
        references: execution.references ?? {},
      },
    });
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

    if (error instanceof AssistantUnavailableError || error instanceof AssistantInvalidModelResponseError) {
      return json(503, { error: error.message });
    }

    logError('assistant_message_failed', error, getRequestMeta(context.request, { userId: auth.user.id }));
    return json(500, {
      error: 'O assistente nao conseguiu concluir o pedido agora. Tente novamente em instantes.',
    });
  }
}
