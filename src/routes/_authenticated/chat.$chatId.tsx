import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { AuthedShell } from "@/components/AuthedShell";
import { Composer } from "./chat.index";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { streamChat } from "@/lib/chat-stream";
import { Button } from "@/components/ui/button";
import { Copy, Check, Volume2, Square, Loader2, RefreshCw, StopCircle, Pencil } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { synthesizeSpeech } from "@/lib/tts.functions";

type Msg = { id: string; role: "user" | "assistant" | "system"; content: string; created_at?: string };

export const Route = createFileRoute("/_authenticated/chat/$chatId")({
  head: () => ({ meta: [{ title: "Chat — Manipuri AI" }] }),
  component: ChatView,
});

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ChatView() {
  const { chatId } = Route.useParams();
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [lang, setLang] = useState<"auto" | "mni" | "mni-mtei" | "en">("auto");
  const [mode, setMode] = useState<"instant" | "think">("instant");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const qc = useQueryClient();

  const messagesQ = useQuery({
    queryKey: ["messages", chatId],
    queryFn: async (): Promise<Msg[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Msg[];
    },
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQ.data, streaming]);

  const runSend = async (text: string) => {
    setSending(true);
    setStreaming("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat({
        chatId,
        message: text,
        language: lang,
        mode,
        signal: controller.signal,
        onChunk: (delta) => setStreaming((s) => s + delta),
      });
      setStreaming("");
      await qc.invalidateQueries({ queryKey: ["messages", chatId] });
      await qc.invalidateQueries({ queryKey: ["chats"] });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "AbortError") {
        toast.message("Stopped");
        await qc.invalidateQueries({ queryKey: ["messages", chatId] });
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to send");
      }
      setStreaming("");
    } finally {
      abortRef.current = null;
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    qc.setQueryData<Msg[]>(["messages", chatId], (old) => [
      ...(old ?? []),
      { id: `opt-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString() },
    ]);
    await runSend(text);
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const regenerate = async () => {
    if (sending) return;
    // find the last user message
    const msgs = messagesQ.data ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // remove the last assistant message from DB so the model produces a fresh one
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    if (lastAssistant) {
      await supabase.from("messages").delete().eq("id", lastAssistant.id);
      qc.setQueryData<Msg[]>(["messages", chatId], (old) => (old ?? []).filter((m) => m.id !== lastAssistant.id));
    }
    // also drop the last user row we just re-send (server will re-insert)
    await supabase.from("messages").delete().eq("id", lastUser.id);
    qc.setQueryData<Msg[]>(["messages", chatId], (old) => (old ?? []).filter((m) => m.id !== lastUser.id));
    await runSend(lastUser.content);
  };

  const editAndResend = async (msg: Msg, newText: string) => {
    if (sending) return;
    const trimmed = newText.trim();
    if (!trimmed) return;
    const msgs = messagesQ.data ?? [];
    const target = msgs.find((m) => m.id === msg.id);
    const cutoff = target?.created_at;
    // delete target + everything after in DB (server will re-insert the edited turn)
    if (cutoff) {
      await supabase.from("messages").delete().eq("chat_id", chatId).gte("created_at", cutoff);
    } else {
      await supabase.from("messages").delete().eq("id", msg.id);
    }
    qc.setQueryData<Msg[]>(["messages", chatId], (old) =>
      (old ?? []).filter((m) => (cutoff ? (m.created_at ?? "") < cutoff : m.id !== msg.id)),
    );
    await runSend(trimmed);
  };

  const messages = messagesQ.data ?? [];
  const canRegenerate = !sending && messages.some((m) => m.role === "assistant");

  return (
    <AuthedShell>
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-6">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} onEdit={editAndResend} disabled={sending} />
            ))}
            {sending && (
              <div className="my-6 flex items-start gap-3">
                <Avatar assistant />
                <div className="min-w-0 flex-1">
                  {streaming ? (
                    <ChatMarkdown content={streaming} />
                  ) : (
                    <div className="flex items-center gap-1 pt-3">
                      <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                      <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0.15s" }} />
                      <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0.3s" }} />
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={bottomRef} />

            <div className="mt-4 flex justify-center">
              {sending ? (
                <Button variant="outline" size="sm" onClick={stop} className="gap-1.5">
                  <StopCircle className="h-3.5 w-3.5" /> Stop generating
                </Button>
              ) : (
                canRegenerate && (
                  <Button variant="outline" size="sm" onClick={regenerate} className="gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                  </Button>
                )
              )}
            </div>
          </div>
        </div>
        <Composer input={input} setInput={setInput} onSubmit={submit} sending={sending} inputRef={inputRef} lang={lang} setLang={setLang} mode={mode} setMode={setMode} />
      </div>
    </AuthedShell>
  );
}

function Avatar({ assistant }: { assistant?: boolean }) {
  if (assistant) {
    return (
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground text-base leading-none font-semibold" aria-hidden="true">
        ꯃ
      </div>
    );
  }
  return <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground text-xs font-semibold">You</div>;
}

function MessageRow({
  message,
  onEdit,
  disabled,
}: {
  message: Msg;
  onEdit: (msg: Msg, newText: string) => Promise<void>;
  disabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [ttsState, setTtsState] = useState<"idle" | "loading" | "playing">("idle");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tts = useServerFn(synthesizeSpeech);
  const isUser = message.role === "user";
  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const speak = async () => {
    if (ttsState === "playing") {
      audioRef.current?.pause();
      audioRef.current = null;
      setTtsState("idle");
      return;
    }
    setTtsState("loading");
    try {
      const clean = message.content.replace(/```[\s\S]*?```/g, "").replace(/[*_#`>]/g, "").trim();
      const { audio, mime } = await tts({ data: { text: clean } });
      const url = `data:${mime};base64,${audio}`;
      const el = new Audio(url);
      audioRef.current = el;
      el.onended = () => setTtsState("idle");
      el.onerror = () => { setTtsState("idle"); toast.error("Playback failed"); };
      await el.play();
      setTtsState("playing");
    } catch (err) {
      setTtsState("idle");
      toast.error(err instanceof Error ? err.message : "Read-aloud failed");
    }
  };

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(message.content);
  };
  const saveEdit = async () => {
    const t = draft.trim();
    if (!t || t === message.content) {
      setEditing(false);
      return;
    }
    setEditing(false);
    await onEdit(message, t);
  };

  return (
    <div className={`my-6 flex items-start gap-3 ${isUser ? "flex-row-reverse msg-pop" : "animate-fade-in"}`}>
      <Avatar assistant={!isUser} />
      <div className={`min-w-0 flex-1 ${isUser ? "flex flex-col items-end" : ""}`}>
        <div className={isUser ? "inline-block max-w-[85%] rounded-2xl rounded-tr-md bg-secondary px-4 py-2.5 text-secondary-foreground" : ""}>
          {isUser ? (
            editing ? (
              <div className="flex flex-col gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                  className="min-h-[60px] resize-none border-0 bg-transparent text-secondary-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void saveEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7">
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveEdit} disabled={disabled} className="h-7">
                    Send
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm">{message.content}</p>
            )
          ) : (
            <ChatMarkdown content={message.content} />
          )}
        </div>
        {!editing && (
          <div className={`mt-1 flex items-center gap-1 text-[10px] text-muted-foreground ${isUser ? "flex-row-reverse" : ""}`}>
            <span>{formatTime(message.created_at)}</span>
            <div className="ml-1 flex items-center gap-0.5">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copy} aria-label="Copy">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
              {isUser ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={startEdit}
                  disabled={disabled}
                  aria-label="Edit message"
                  title="Edit message"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={speak}
                  disabled={ttsState === "loading"}
                  aria-label={ttsState === "playing" ? "Stop" : "Read aloud in Manipuri"}
                  title={ttsState === "playing" ? "Stop" : "Read aloud in Manipuri"}
                >
                  {ttsState === "loading" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : ttsState === "playing" ? (
                    <Square className="h-3.5 w-3.5" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
