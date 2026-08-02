import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { Send, Loader2, MessageCircle, Plus, ArrowLeft, Trash2 } from "lucide-react";
import {
  useConversations,
  useConversation,
  useSendMessage,
  useDeleteConversation,
} from "@/features/ai/hooks";

export const Route = createFileRoute("/merchant/ai")({
  head: () => ({ meta: [{ title: "AI Assistant · Merchant · Zentro" }] }),
  component: AIPage,
});

function AIPage() {
  const { data: conversations, isLoading: convsLoading } = useConversations();
  const [activeConvId, setActiveConvId] = useState<string | undefined>();
  const { data: activeConv, isLoading: msgsLoading } =
    useConversation(activeConvId);
  const sendMutation = useSendMessage();
  const deleteMutation = useDeleteConversation();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = activeConv?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    try {
      const result = await sendMutation.mutateAsync({
        message: text,
        conversationId: activeConvId,
      });
      setActiveConvId(result.conversation_id);
    } finally {
      setSending(false);
    }
  }

  function handleNewChat() {
    setActiveConvId(undefined);
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (activeConvId === id) setActiveConvId(undefined);
    await deleteMutation.mutateAsync(id);
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-5xl gap-4">
      <aside className="hidden w-64 shrink-0 flex-col rounded-xl border border-border bg-muted/30 sm:flex">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Conversations</h2>
          <button
            onClick={handleNewChat}
            className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            title="New conversation"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {convsLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {conversations?.map((conv) => (
            <div
              key={conv.id}
              className={`group relative rounded-lg text-left text-xs transition-colors ${
                activeConvId === conv.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <button
                onClick={() => setActiveConvId(conv.id)}
                className="w-full px-3 py-2 text-left"
              >
                <p className="truncate font-medium">{conv.title}</p>
                <p className="mt-0.5 opacity-60">
                  {new Date(conv.updated_at).toLocaleDateString()}
                </p>
              </button>
              <button
                onClick={(e) => handleDelete(conv.id, e)}
                className="absolute right-1 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                title="Delete conversation"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          {!convsLoading && conversations?.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No conversations yet
            </p>
          )}
        </div>
      </aside>

      <div className="flex flex-1 flex-col rounded-xl border border-border">
        {activeConvId && activeConv ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <button
                onClick={handleNewChat}
                className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted sm:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <h3 className="truncate text-sm font-medium">
                {activeConv.conversation.title}
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {msgsLoading && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <form
              onSubmit={handleSend}
              className="flex items-center gap-2 border-t border-border p-4"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                disabled={sending}
                className="flex-1 rounded-xl border border-border bg-muted px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </form>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <MessageCircle className="mb-3 h-10 w-10 opacity-30" />
            <p className="mb-1 font-medium text-foreground">
              Merchant Assistant
            </p>
            <p className="max-w-xs">
              Select a conversation or start a new one to ask about your store.
            </p>
            <button
              onClick={handleNewChat}
              className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="mr-1.5 inline h-4 w-4" /> New conversation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
