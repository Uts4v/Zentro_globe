export const aiKeys = {
  conversations: () => ["ai", "conversations"] as const,
  conversation: (id: string) => ["ai", "conversations", id] as const,
  messages: (id: string) => ["ai", "conversations", id, "messages"] as const,
};
