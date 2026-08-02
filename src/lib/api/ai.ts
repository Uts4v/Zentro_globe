import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";

export interface AIConversation {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AIConversationMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls: any[] | null;
  tool_results: any[] | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export interface ConversationDetail {
  conversation: AIConversation;
  messages: AIConversationMessage[];
}

export interface ChatResponse {
  message_id: string;
  content: string;
  conversation_id: string;
  request_id: string;
  tokens: number | null;
}

export const chatApi = {
  send: async (message: string, conversationId?: string): Promise<ChatResponse> => {
    const data = await djangoFetch<ChatResponse>(apiUrl("/ai/chat/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        message,
        conversation_id: conversationId || null,
      }),
    });
    return data;
  },
};

export const conversationApi = {
  list: async (): Promise<AIConversation[]> => {
    const data = await djangoFetch<AIConversation[]>(apiUrl("/ai/conversations/"), {
      headers: authHeaders(),
    });
    return data;
  },
  get: async (id: string): Promise<ConversationDetail> => {
    const data = await djangoFetch<ConversationDetail>(apiUrl(`/ai/conversations/${id}/`), {
      headers: authHeaders(),
    });
    return data;
  },
  delete: async (id: string): Promise<void> => {
    await djangoFetch<void>(apiUrl(`/ai/conversations/${id}/`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },
};
