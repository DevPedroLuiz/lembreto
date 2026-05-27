import { apiPost } from '../api/client';

export interface AssistantResponse {
  conversationId: string;
  message: string;
  action: {
    type: string;
    status: 'success' | 'failed' | 'needs_confirmation' | 'skipped';
    entityType?: string;
    entityId?: string;
    entityTitle?: string;
  };
  references?: {
    lastCreatedTaskId?: string;
    lastUpdatedTaskId?: string;
    listedTaskIds?: string[];
    pendingConfirmationId?: string;
  };
}

export async function sendAssistantMessage(input: {
  message: string;
  conversationId?: string | null;
  token: string;
}): Promise<AssistantResponse> {
  return apiPost<AssistantResponse>(
    '/api/assistant/message',
    {
      message: input.message,
      conversationId: input.conversationId ?? null,
    },
    input.token,
  );
}
