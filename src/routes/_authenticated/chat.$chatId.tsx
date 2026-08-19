import { lazy, Suspense, useState, useRef, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { Composer, ImageGeneratingAnimation, StreamingAssistantContent, ThinkingLoader } from "@/components/chat-shared";
const ChatMarkdown = lazy(() => import("@/components/ChatMarkdown").then(m => ({ default: m.ChatMarkdown })));
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { streamChat } from "@/lib/chat-stream";
import { Button } from "@/components/ui/button";
import { Copy, Check, Volume2, Square, RefreshCw, StopCircle, Pencil, Wand2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { synthesizeSpeech } from "@/lib/tts.functions";
import { parseImageMessage, generateImages, parseImageRequest } from "@/lib/image-gen";
import { ImageResultCard } from "@/components/ImageResultCard";
import { appendStreamingText, setActiveStream, updateActiveStream, useActiveStream } from "@/lib/active-stream";
import { getCachedResponse, setCachedResponse, getUserPrefs, setUserPrefs } from "@/lib/chat-cache";

type Msg = { id: string; role: "user" | "assistant" | "system"; content: string; created_at?: string };

function isPersistedMessageId(id: string) {
  return !id.startsWith("u-") && !id.startsWith("a-") && !id.startsWith("opt-");
}

export const Route = createFileRoute("/_authenticated/chat/$chatId")({
  head: () => ({ meta: [{ title: "Chat — Manipuri AI" }, { name: "description", content: "Continue your Manipuri AI conversation in Meiteilon, Meitei Mayek script or English with streaming replies." }, { name: "robots", content: "noindex, nofollow" }] }),
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
  const [lang, setLang] = useState<"auto" | "mni" | "mni-mtei" | "en">(() => getUserPrefs()?.lang ?? "auto");
  const [mode, setMode] = useState<"instant" | "think">(() => getUserPrefs()?.mode ?? "instant");
  const [sending, setSending] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const qc = useQueryClient();
  const active = useActiveStream();
  // Keep the active stream authoritative for this chat until the database rows
  // have had time to settle. This prevents long replies from clearing during
  // route changes or refetches.
  const activeForChat = active && active.chatId === chatId ? active : null;
  const inflight = activeForChat && !activeForChat.done ? activeForChat : null;

  // Number of persisted rows when the current turn started. Used to decide when
  // the turn has landed in the database — never content matching, which hid
  // earlier identical messages (e.g. repeated "hi").
  const turnBaseRef = useRef<number | null>(null);

  const messagesQ = useQuery({
    queryKey: ["messages", chatId],
    queryFn: async (): Promise<Msg[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true })
        .order("role", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Msg[];
    },
  });

  // Once the database has the completed turn, drop the cross-route store.
  useEffect(() => {
    if (!activeForChat?.done) return;
    const timer = window.setTimeout(() => {
      const rows = qc.getQueryData<Msg[]>(["messages", chatId]) ?? messagesQ.data ?? [];
      const base = turnBaseRef.current;
      // If we are showing history (base is null) or we've seen more rows than we started with,
      // it's safe to clear the local carryover.
      if (base === null || rows.length > base) {
        setActiveStream(null);
        turnBaseRef.current = null;
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [activeForChat, chatId, messagesQ.data, qc]);

  useEffect(() => {
    if (!activeForChat?.done) return;
    void qc.invalidateQueries({ queryKey: ["messages", chatId] });
  }, [activeForChat?.done, chatId, qc]);


  useEffect(() => {
    inputRef.current?.focus();
  }, [chatId]);


  const checkScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 80;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    setIsFollowingLatest(isAtBottom);
  };

  useEffect(() => {
    if (isFollowingLatest && (streaming || generatingImage || inflight?.streaming)) {
      const container = scrollContainerRef.current;
      if (container) {
        // Use scrollTop instead of scrollIntoView to avoid window-level scrolling
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [streaming, generatingImage, inflight?.streaming, isFollowingLatest]);

  const scrollToBottom = () => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
    setIsFollowingLatest(true);
  };


  const runSend = async (text: string, imgs: string[] = []) => {
    // Persist prefs
    setUserPrefs({ lang, mode });

    setSending(true);
    setStreaming("");
    const imgTags = imgs.map((u) => `![image](${u})`).join("\n");
    const stored = text ? (imgTags ? `${imgTags}\n\n${text}` : text) : imgTags;
    
    const hasImages = imgs.length > 0;
    const cached = null; // getCachedResponse(text) disabled per user request

    turnBaseRef.current = (qc.getQueryData<Msg[]>(["messages", chatId]) ?? []).length;
    setActiveStream({
      chatId,
      timestamp: Date.now(),
      userText: stored,
      userImages: imgs,
      streaming: cached || "",
      generatingImage: false,
      done: Boolean(cached),
    });

    if (cached) {
      setStreaming(cached);
    }

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
          if (cached) return;
          setStreaming((s) => s + delta);
          appendStreamingText(delta);
        },
      });

      if (!cached && result.reply) {
        setCachedResponse(text, result.reply);
      }
      const now = new Date().toISOString();
      qc.setQueryData<Msg[]>(["messages", chatId], (old) => {
        const rows = old ?? [];
        const withoutOptimisticUser = [...rows];
        let optIdx = -1;
        for (let i = withoutOptimisticUser.length - 1; i >= 0; i--) {
          const m = withoutOptimisticUser[i];
          if (m.id.startsWith("opt-") && m.role === "user" && m.content === stored) {
            optIdx = i;
            break;
          }
        }
        if (optIdx !== -1) {
          withoutOptimisticUser.splice(optIdx, 1);
        }
        return [
          ...withoutOptimisticUser,
          { id: `u-${Date.now()}`, role: "user" as const, content: stored, created_at: now },
          { id: `a-${Date.now()}`, role: "assistant" as const, content: result.reply, created_at: now },
        ];
      });
      updateActiveStream({ done: true, streaming: result.reply });
      
      // Invalidate queries so the background cache reflects the new turn.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["messages", chatId] }),
        qc.invalidateQueries({ queryKey: ["chats"] }),
      ]);
      
      // Wait for a few frames to ensure the newly fetched DB rows are rendered
      // and the component has stabilized before clearing the local streaming state.
      // This eliminates the "blink" where the reply briefly disappears between
      // finishing and the DB refetch completing.
      setTimeout(() => {
        setStreaming("");
        // Also clear the active stream if we are finished and the DB has the data
        const currentMsgs = qc.getQueryData<Msg[]>(["messages", chatId]) ?? [];
        if (turnBaseRef.current !== null && currentMsgs.length > turnBaseRef.current) {
          setActiveStream(null);
          turnBaseRef.current = null;
        }
      }, 50);


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
  // Logic to handle in-flight vs persisted turns.
  // When a stream starts, we record the message count. 
  // We only hide messages from the DB list if they represent the turn that is currently active in our stream store.
  if (!activeForChat) {
    turnBaseRef.current = null;
  } else if (turnBaseRef.current === null && messagesQ.isSuccess) {
    // If we have an active stream but haven't set a base yet (e.g. page reload during stream),
    // we assume the last turn might be the one we are streaming if it has no assistant reply.
    // We check if the last message in DB matches the active turn's text or images.
    const lastMsg = messages[messages.length - 1];
    // Check if the last message in DB matches the active turn's text or images.
    // If it does, and it's a user message, we know it's a turn in progress.
    const isMatchingUser = lastMsg && lastMsg.role === "user" && 
      (lastMsg.content === activeForChat.userText || 
       (activeForChat.userImages?.length && lastMsg.content.includes("![image](")));

    if (isMatchingUser) {
      turnBaseRef.current = messages.length - 1;
    } else {
      turnBaseRef.current = messages.length;
    }
  }

  // A turn is "persisted" if the database has more messages than the count when we started.
  // We strictly check the message count here.
  const turnPersisted = turnBaseRef.current !== null && messages.length > turnBaseRef.current;
  
  // renderedMessages are the ones from the database. 
  // We only slice them if we are actively streaming a turn that hasn't landed in the DB yet.
  const renderedMessages = (activeForChat && !turnPersisted && turnBaseRef.current !== null)
    ? messages.slice(0, turnBaseRef.current)
    : messages;

  const canRegenerate = !sending && !inflight && renderedMessages.some((m) => m.role === "assistant");

  // Only show the carryover (optimistic/streaming UI) if it's actually active and not yet in the DB.
  // We use the activeForChat object which contains the userText and userImages.
  const showCarryover = activeForChat && !turnPersisted ? activeForChat : null;




  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-black">
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
        onScroll={checkScroll}
      >
          <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
            {(() => {
              const elements: React.ReactNode[] = [];
              for (let i = 0; i < renderedMessages.length; i++) {
                const msg = renderedMessages[i];
                elements.push(
                  <div key={`msg-${msg.id}`} className="flex flex-col">
                    <MessageRow message={msg} chatId={chatId} lang={lang} onEdit={editAndResend} disabled={sending} />
                  </div>
                );
              }
              return elements;
            })()}
            {showCarryover && (
              <div className="msg-pop">
                {/* User message first in carryover */}
                <div className="my-8 flex w-full flex-col items-end">
                  <div className="flex max-w-[90%] flex-row-reverse gap-3 md:gap-4">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-800 text-neutral-400 text-[10px] font-bold uppercase tracking-tighter">You</div>
                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="inline-block rounded-2xl rounded-tr-md bg-neutral-900 px-4 py-3 text-white shadow-sm">
                        {showCarryover.userImages && showCarryover.userImages.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-2">
                            {showCarryover.userImages.map((src, i) => (
                              <div key={i} className="h-16 w-16 overflow-hidden rounded-lg border border-white/10">
                                <img src={src} alt="" className="h-full w-full object-cover" />
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">{showCarryover.userText.replace(/!\[[^\]]*\]\([^)]+\)\n?/g, "").trim() || (showCarryover.userImages?.length ? "" : "(image)")}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Assistant response below user prompt in carryover */}
                <div className="my-8 flex w-full flex-col items-start">
                  <div className="flex max-w-[90%] gap-3 md:gap-4">
                    <Avatar assistant />
                    <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                      <div className="inline-block rounded-2xl rounded-tl-md px-4 py-3 text-white">
                        {showCarryover.generatingImage ? (
                          <ImageGeneratingAnimation />
                        ) : (showCarryover.streaming || showCarryover.done || streaming) ? (
                          <Suspense fallback={<div className="h-20 w-full animate-pulse rounded bg-muted/20" />}>
                            <StreamingAssistantContent content={showCarryover.streaming || streaming} />
                          </Suspense>
                        ) : (
                          <ThinkingLoader />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {sending && !activeForChat && (
              <div className="my-8 flex w-full flex-col items-start msg-pop">
                <div className="flex max-w-[90%] gap-3 md:gap-4">
                  <Avatar assistant />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                    <div className="inline-block rounded-2xl rounded-tl-md px-4 py-3 text-white">
                      {generatingImage ? (
                        <ImageGeneratingAnimation />
                      ) : (streaming || (inflight?.done ?? false)) ? (
                        <StreamingAssistantContent content={streaming} />
                      ) : (
                        <ThinkingLoader />
                      )}
                    </div>
                  </div>
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
        
        {(!isFollowingLatest && (sending || inflight)) && (
          <div className="absolute bottom-32 left-1/2 z-10 -translate-x-1/2">
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={scrollToBottom}
              className="rounded-full border shadow-md gap-2 px-4 animate-in fade-in slide-in-from-bottom-2"
            >
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              New response
            </Button>
          </div>
        )}

        <Composer input={input} setInput={setInput} images={images} setImages={setImages} onSubmit={submit} sending={sending || Boolean(inflight)} inputRef={inputRef} lang={lang} setLang={setLang} mode={mode} setMode={setMode} />
      </div>
  );
}


function Avatar({ assistant }: { assistant?: boolean }) {
  if (assistant) {
    return (
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-black text-base leading-none font-semibold" aria-hidden="true">
        ꯃ
      </div>
    );
  }
  return <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-800 text-neutral-400 text-[10px] font-bold uppercase tracking-tighter">You</div>;
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
              <img src={p.url} alt="attachment" loading="lazy" decoding="async" sizes="(max-width: 640px) 60vw, 220px" className="max-h-64 max-w-[220px] object-cover" />
            </a>
          ))}
        </div>
      )}
      {texts.length > 0 && (
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">{texts.map((t) => t.text).join("\n\n")}</p>
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
          utter.onerror = (e) => { 
            console.error("SpeechSynthesis error:", e);
            setTtsState("idle"); 
            toast.error("Read-aloud failed. Please check your device's silent mode and permissions."); 
          };
          window.speechSynthesis.cancel(); // Stop any pending speech
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
    <>
      <div className={`my-8 flex w-full flex-col ${isUser ? "items-end" : "items-start"} msg-pop group/row`}>
        <div className={`flex max-w-[90%] gap-3 md:gap-4 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[10px] font-bold uppercase tracking-tighter ${isUser ? "bg-neutral-800 text-neutral-400" : "bg-neutral-900 text-neutral-500"}`}>
            {isUser ? "You" : <span className="text-[14px]">ꯃ</span>}
          </div>
          
          <div className="flex min-w-0 flex-col gap-2">
            <div className={`relative group/msg inline-block rounded-2xl px-4 py-3 shadow-sm ${isUser ? "rounded-tr-md bg-neutral-900 text-white" : "rounded-tl-md bg-transparent text-white"}`}>
              {editing ? (
                <div className="w-full min-w-[300px] space-y-3 rounded-2xl bg-secondary p-3 shadow-md border border-border/40">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={Math.min(10, Math.max(2, draft.split("\n").length))}
                    className="min-h-[80px] resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed text-secondary-foreground focus-visible:ring-0"
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
                    <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-8 text-xs">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveEdit} disabled={disabled} className="h-8 text-xs px-4">
                      Save & Submit
                    </Button>
                  </div>
                </div>
              ) : isUser ? (
                <>
                  <UserContent content={message.content} />
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={startEdit} 
                    disabled={disabled}
                    className="absolute -left-10 top-0 h-8 w-8 rounded-full opacity-100 md:opacity-0 md:group-hover/msg:opacity-100 transition-opacity"
                    title="Edit message"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </>
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
              <div className={`flex items-center gap-2 px-1 text-[11px] text-neutral-500 ${isUser ? "justify-end" : "justify-start"}`}>
                <div className={`flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover/row:opacity-100 transition-opacity ${isUser ? "flex-row-reverse" : ""}`}>
                  {!isUser && (
                    <>
                      <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md hover:bg-neutral-900 hover:text-white" onClick={copy} title="Copy response">
                        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-md hover:bg-neutral-900 hover:text-white"
                        onClick={speak}
                        disabled={ttsState === "loading"}
                        title={ttsState === "playing" ? "Stop" : "Read aloud in Manipuri"}
                      >
                        {ttsState === "loading" ? (
                          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                        ) : ttsState === "playing" ? (
                          <Square className="h-3.5 w-3.5" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-md hover:bg-neutral-900 hover:text-white"
                        onClick={openCorrection}
                        title="Suggest a Manipuri correction"
                      >
                        <Wand2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
                <span>{formatTime(message.created_at)}</span>
              </div>
            )}
          </div>
        </div>
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
              {savingCorrection ? <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" /> : null}
              Submit correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
