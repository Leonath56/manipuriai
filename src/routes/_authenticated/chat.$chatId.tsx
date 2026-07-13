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
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, Sparkles, Volume2, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { synthesizeSpeech } from "@/lib/tts.functions";

type Msg = { id: string; role: "user" | "assistant" | "system"; content: string };

export const Route = createFileRoute("/_authenticated/chat/$chatId")({
  head: () => ({ meta: [{ title: "Chat — Manipuri AI" }] }),
  component: ChatView,
});

function ChatView() {
  const { chatId } = Route.useParams();
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<"auto" | "mni" | "mni-mtei" | "en">("auto");
  const [mode, setMode] = useState<"instant" | "think">("instant");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const messagesQ = useQuery({
    queryKey: ["messages", chatId],
    queryFn: async (): Promise<Msg[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content")
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");

    qc.setQueryData<Msg[]>(["messages", chatId], (old) => [
      ...(old ?? []),
      { id: `opt-${Date.now()}`, role: "user", content: text },
    ]);
    setStreaming("");

    try {
      await streamChat({
        chatId,
        message: text,
        language: lang,
        mode,
        onChunk: (delta) => setStreaming((s) => s + delta),
      });
      setStreaming("");
      await qc.invalidateQueries({ queryKey: ["messages", chatId] });
      await qc.invalidateQueries({ queryKey: ["chats"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
      setStreaming("");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const messages = messagesQ.data ?? [];

  return (
    <AuthedShell>
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-6">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} />
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
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
    );
  }
  return <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground text-xs font-semibold">You</div>;
}

function MessageRow({ message }: { message: Msg }) {
  const [copied, setCopied] = useState(false);
  const [ttsState, setTtsState] = useState<"idle" | "loading" | "playing">("idle");
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
      // Strip markdown for cleaner speech
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

  return (
    <div className={`my-6 flex items-start gap-3 animate-fade-in ${isUser ? "flex-row-reverse" : ""}`}>
      <Avatar assistant={!isUser} />
      <div className={`min-w-0 flex-1 ${isUser ? "flex flex-col items-end" : ""}`}>
        <div className={isUser ? "max-w-[85%] rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-primary-foreground" : ""}>
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm">{message.content}</p>
          ) : (
            <ChatMarkdown content={message.content} />
          )}
        </div>
        {!isUser && (
          <div className="mt-1 flex items-center gap-0.5 text-muted-foreground">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copy} aria-label="Copy">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
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
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toast.success("Thanks for the feedback")} aria-label="Like"><ThumbsUp className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toast.success("Feedback noted")} aria-label="Dislike"><ThumbsDown className="h-3.5 w-3.5" /></Button>
          </div>
        )}
      </div>
    </div>
  );
}
