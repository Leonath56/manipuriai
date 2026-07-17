import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";

import { Composer, ImageGeneratingAnimation, StreamingAssistantContent } from "@/components/chat-shared";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { streamChat } from "@/lib/chat-stream";
import { Button } from "@/components/ui/button";
import { Copy, Check, Volume2, Square, Loader2, RefreshCw, StopCircle, Pencil, Wand2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { synthesizeSpeech } from "@/lib/tts.functions";
import { parseImageMessage, generateImages, parseImageRequest } from "@/lib/image-gen";
import { ImageResultCard } from "@/components/ImageResultCard";
import { appendStreamingText, setActiveStream, updateActiveStream, useActiveStream } from "@/lib/active-stream";

type Msg = { id: string; role: "user" | "assistant" | "system"; content: string; created_at?: string };

function isPersistedMessageId(id: string) {
  return !id.startsWith("u-") && !id.startsWith("a-") && !id.startsWith("opt-");
}

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
  const [generatingImage, setGeneratingImage] = useState(false);
  const [streaming, setStreaming] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const qc = useQueryClient();
  const active = useActiveStream();
  // Keep the active stream authoritative for this chat until the database rows
  // have had time to settle. This prevents long replies from clearing during
  // route changes or refetches.
  const activeForChat = active && active.chatId === chatId ? active : null;
  const inflight = activeForChat && !activeForChat.done ? activeForChat : null;

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

  // Once the database has the completed turn, wait briefly before dropping the
  // store. Optimistic cache rows are intentionally ignored here; clearing from
  // those fake rows is what made long answers disappear until refresh.
  useEffect(() => {
    if (!activeForChat?.done) return;
    const timer = window.setTimeout(() => {
      const rows = qc.getQueryData<Msg[]>(["messages", chatId]) ?? messagesQ.data ?? [];
      let activeTurnStart = -1;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].role === "user" && rows[i].content === activeForChat.userText) {
          activeTurnStart = i;
          break;
        }
      }
      const hasPersistedReply =
        activeTurnStart >= 0 &&
        isPersistedMessageId(rows[activeTurnStart].id) &&
        rows.slice(activeTurnStart + 1).some((m) => m.role === "assistant" && isPersistedMessageId(m.id));
      if (hasPersistedReply) setActiveStream(null);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [activeForChat, chatId, messagesQ.data, qc]);

  useEffect(() => {
    if (!activeForChat?.done) return;
    void qc.invalidateQueries({ queryKey: ["messages", chatId] });
  }, [activeForChat?.done, chatId, qc]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQ.data, streaming, generatingImage, inflight?.streaming]);


  const runSend = async (text: string, imgs: string[] = []) => {
    setSending(true);
    setStreaming("");
    const imgTags = imgs.map((u) => `![image](${u})`).join("\n");
    const stored = text ? (imgTags ? `${imgTags}\n\n${text}` : text) : imgTags;
    setActiveStream({
      chatId,
      userText: stored,
      userImages: imgs,
      streaming: "",
      generatingImage: false,
      done: false,
    });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await streamChat({
        chatId,
        message: text,
        images: imgs,
        language: lang,
        mode,
        signal: controller.signal,
        onChunk: (delta) => {
          setStreaming((s) => s + delta);
          appendStreamingText(delta);
        },
      });
      const now = new Date().toISOString();
      qc.setQueryData<Msg[]>(["messages", chatId], (old) => {
        const rows = old ?? [];
        const withoutOptimisticUser = rows.filter((m) => !(m.id.startsWith("opt-") && m.role === "user" && m.content === stored));
        return [
          ...withoutOptimisticUser,
          ...(withoutOptimisticUser.some((m) => m.role === "user" && m.content === stored)
            ? []
            : [{ id: `u-${Date.now()}`, role: "user" as const, content: stored, created_at: now }]),
          { id: `a-${Date.now()}`, role: "assistant" as const, content: result.reply, created_at: now },
        ];
      });
      updateActiveStream({ done: true, streaming: result.reply });
      void qc.invalidateQueries({ queryKey: ["messages", chatId] });
      await qc.invalidateQueries({ queryKey: ["chats"] });
      setStreaming("");
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "AbortError") {
        toast.message("Stopped");
        await qc.invalidateQueries({ queryKey: ["messages", chatId] });
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to send");
      }
      setStreaming("");
      setActiveStream(null);
    } finally {
      abortRef.current = null;
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if ((!text && images.length === 0) || sending) return;
    const sentImages = images;
    const imgTags = sentImages.map((u) => `![image](${u})`).join("\n");
    const stored = text ? (imgTags ? `${imgTags}\n\n${text}` : text) : imgTags;
    setInput("");
    setImages([]);

    // Auto-detect image intent — generate inline in the current chat
    const imageRequest = text && sentImages.length === 0 ? parseImageRequest(text) : null;
    if (imageRequest) {
      qc.setQueryData<Msg[]>(["messages", chatId], (old) => [
        ...(old ?? []),
        { id: `opt-${Date.now()}`, role: "user", content: stored, created_at: new Date().toISOString() },
      ]);
      setSending(true);
      setGeneratingImage(true);
      try {
        await generateImages({
          chatId,
          prompt: imageRequest.prompt,
          aspectRatio: imageRequest.aspectRatio,
          quality: "standard",
          count: 1,
          style: "none",
        });
        await qc.invalidateQueries({ queryKey: ["messages", chatId] });
        await qc.invalidateQueries({ queryKey: ["chats"] });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Image generation failed");
      } finally {
        setGeneratingImage(false);
        setSending(false);
        inputRef.current?.focus();
      }
      return;
    }

    await runSend(text, sentImages);
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
  let activeTurnStart = -1;
  if (activeForChat) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user" && messages[i].content === activeForChat.userText) {
        activeTurnStart = i;
        break;
      }
    }
  }
  const renderedMessages = activeForChat
    ? messages.filter((m) => {
        const idx = messages.indexOf(m);
        if (activeTurnStart >= 0 && idx >= activeTurnStart) return false;
        if (m.role === "user" && m.content === activeForChat.userText) return false;
        if (m.role === "assistant" && m.content === activeForChat.streaming) return false;
        return true;
      })
    : messages;
  const canRegenerate = !sending && !inflight && renderedMessages.some((m) => m.role === "assistant");
  const showCarryover = activeForChat;

  return (
    <div className="flex h-full flex-col">

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-6">
            {renderedMessages.map((m) => (
              <MessageRow key={m.id} message={m} chatId={chatId} lang={lang} onEdit={editAndResend} disabled={sending} />
            ))}
            {showCarryover && (
              <div>
                <div className="my-6 flex flex-row-reverse items-start gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground text-xs font-semibold">You</div>
                  <div className="inline-block max-w-[85%] rounded-2xl rounded-tr-md bg-secondary px-4 py-2.5 text-secondary-foreground">
                    <p className="whitespace-pre-wrap text-sm">{showCarryover.userText.replace(/!\[[^\]]*\]\([^)]+\)\n?/g, "").trim() || "(image)"}</p>
                  </div>
                </div>
                <div className="my-6 flex items-start gap-3">
                  <Avatar assistant />
                  <div className="min-w-0 flex-1">
                    {showCarryover.generatingImage ? (
                      <ImageGeneratingAnimation />
                    ) : showCarryover.streaming ? (
                      <StreamingAssistantContent content={showCarryover.streaming} />
                    ) : (
                      <div className="flex items-center gap-1 pt-3">
                        <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                        <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0.15s" }} />
                        <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0.3s" }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {sending && !activeForChat && (
              <div className="my-6 flex items-start gap-3">
                <Avatar assistant />
                <div className="min-w-0 flex-1">
                  {generatingImage ? (
                    <ImageGeneratingAnimation />
                  ) : streaming ? (
                    <StreamingAssistantContent content={streaming} />
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
              {sending || inflight ? (
                sending ? (
                  <Button variant="outline" size="sm" onClick={stop} className="gap-1.5">
                    <StopCircle className="h-3.5 w-3.5" /> Stop generating
                  </Button>
                ) : null
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
        <Composer input={input} setInput={setInput} images={images} setImages={setImages} onSubmit={submit} sending={sending || Boolean(inflight)} inputRef={inputRef} lang={lang} setLang={setLang} mode={mode} setMode={setMode} />
      </div>
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
function UserContent({ content }: { content: string }) {
  const parts: Array<{ type: "img"; url: string } | { type: "text"; text: string }> = [];
  const re = /!\[[^\]]*\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      const t = content.slice(last, m.index).trim();
      if (t) parts.push({ type: "text", text: t });
    }
    parts.push({ type: "img", url: m[1] });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    const t = content.slice(last).trim();
    if (t) parts.push({ type: "text", text: t });
  }
  const imgs = parts.filter((p) => p.type === "img") as Array<{ type: "img"; url: string }>;
  const texts = parts.filter((p) => p.type === "text") as Array<{ type: "text"; text: string }>;
  return (
    <div className="flex flex-col gap-2">
      {imgs.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 ${imgs.length === 1 ? "" : ""}`}>
          {imgs.map((p, i) => (
            <a key={i} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border">
              <img src={p.url} alt="attachment" className="max-h-64 max-w-[220px] object-cover" />
            </a>
          ))}
        </div>
      )}
      {texts.length > 0 && (
        <p className="whitespace-pre-wrap text-sm">{texts.map((t) => t.text).join("\n\n")}</p>
      )}
    </div>
  );
}


function MessageRow({
  message,
  chatId,
  lang,
  onEdit,
  disabled,
}: {
  message: Msg;
  chatId: string;
  lang: "auto" | "mni" | "mni-mtei" | "en";
  onEdit: (msg: Msg, newText: string) => Promise<void>;
  disabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [ttsState, setTtsState] = useState<"idle" | "loading" | "playing">("idle");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correction, setCorrection] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const [savingCorrection, setSavingCorrection] = useState(false);
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
      const result = await tts({ data: { text: clean } });
      if (!result.audio || !result.mime) {
        // Server-side TTS unavailable (credits exhausted / rate-limited / no key) —
        // fall back to the browser's built-in speech synthesis.
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          const utter = new SpeechSynthesisUtterance(clean);
          utter.rate = 0.95;
          utter.onend = () => setTtsState("idle");
          utter.onerror = () => { setTtsState("idle"); toast.error("Playback failed"); };
          window.speechSynthesis.speak(utter);
          setTtsState("playing");
        } else {
          setTtsState("idle");
          toast.error("Read-aloud unavailable on this device");
        }
        return;
      }
      const url = `data:${result.mime};base64,${result.audio}`;
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

  const openCorrection = () => {
    setCorrection(message.content);
    setCorrectionNote("");
    setCorrectOpen(true);
  };
  const submitCorrection = async () => {
    const corrected = correction.trim();
    if (!corrected) { toast.error("Please write the corrected version"); return; }
    if (corrected === message.content.trim()) { toast.error("Correction is the same as the original"); return; }
    setSavingCorrection(true);
    try {
      const { data: sess } = await supabase.auth.getUser();
      const userId = sess.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.from("manipuri_corrections").insert({
        user_id: userId,
        chat_id: chatId,
        message_id: message.id.startsWith("opt-") || message.id.startsWith("a-") ? null : message.id,
        original_text: message.content,
        corrected_text: corrected,
        note: correctionNote.trim() || null,
        language: lang,
      });
      if (error) throw error;
      toast.success("Thanks! Your correction helps train Manipuri AI 🙏");
      setCorrectOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit correction");
    } finally {
      setSavingCorrection(false);
    }
  };

  return (
    <div className={`my-6 flex items-start gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
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
              <UserContent content={message.content} />
            )
          ) : (() => {
            const imgMeta = parseImageMessage(message.content);
            if (imgMeta) {
              return (
                <ImageResultCard
                  prompt={imgMeta.prompt}
                  images={imgMeta.images}
                  onRegenerate={async () => {
                    try {
                      await generateImages({
                        chatId,
                        prompt: imgMeta.prompt,
                        aspectRatio: imgMeta.aspectRatio,
                        quality: imgMeta.quality,
                        count: imgMeta.images.length,
                        style: imgMeta.style,
                      });
                      window.location.reload();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Regeneration failed");
                    }
                  }}
                />
              );
            }
            return <ChatMarkdown content={message.content} />;
          })()}
        </div>
        {!editing && (
          <div className={`mt-1 flex items-center gap-1 text-[10px] text-muted-foreground ${isUser ? "flex-row-reverse" : ""}`}>
            <span>{formatTime(message.created_at)}</span>
            <div className="ml-1 flex items-center gap-0.5">
              {!isUser && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copy} aria-label="Copy">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              )}
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
                <>
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={openCorrection}
                    aria-label="Suggest a Manipuri correction"
                    title="Suggest a Manipuri correction — help train Manipuri AI"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <Dialog open={correctOpen} onOpenChange={setCorrectOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Suggest a Manipuri correction</DialogTitle>
            <DialogDescription>
              Help improve Manipuri AI. Fix grammar, spelling, tone, or the whole sentence — your correction gets sent to the developer for review.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Original reply</div>
              <div className="max-h-32 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 text-xs whitespace-pre-wrap">{message.content}</div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium">Your corrected version</div>
              <Textarea
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                rows={5}
                placeholder="Write how it should have been said in Manipuri…"
                className="text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium">Note (optional)</div>
              <Textarea
                value={correctionNote}
                onChange={(e) => setCorrectionNote(e.target.value)}
                rows={2}
                placeholder="e.g. 'pangbageda' should be 'mateng pangjouge'"
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCorrectOpen(false)} disabled={savingCorrection}>Cancel</Button>
            <Button onClick={submitCorrection} disabled={savingCorrection}>
              {savingCorrection ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
