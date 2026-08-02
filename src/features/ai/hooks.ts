import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aiKeys } from "./query-keys";
import { chatApi, conversationApi } from "@/lib/api/ai";

export function useConversations() {
  return useQuery({
    queryKey: aiKeys.conversations(),
    queryFn: conversationApi.list,
    staleTime: 60_000,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: aiKeys.conversation(id ?? ""),
    queryFn: () => conversationApi.get(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, conversationId }: { message: string; conversationId?: string }) =>
      chatApi.send(message, conversationId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: aiKeys.conversations() });
      qc.invalidateQueries({ queryKey: aiKeys.conversation(data.conversation_id) });
    },
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => conversationApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiKeys.conversations() });
    },
  });
}
