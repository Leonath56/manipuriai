import { Suspense, useState, useRef, useEffect, useMemo, useCallback, memo, type CSSProperties } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { Composer, ImageGeneratingAnimation, StreamingAssistantContent, ThinkingLoader } from "@/components/chat-shared";
// Static import: this module is already in the shared chunk via chat-shared,
// and a lazy boundary here suspended the whole route when a finished stream
// swapped to the saved message — the visible "page blink" after each answer.
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { streamChat } from "@/lib/chat-stream";
import { Button } from "@/components/ui/button";
import { Copy, Check, Volume2, Square, RefreshCw, Pencil, Wand2, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { synthesizeSpeech } from "@/lib/tts.functions";
import { parseImageMessage, generateImages, parseImageRequest } from "@/lib/image-gen";
import { ImageResultCard } from "@/components/ImageResultCard";
import { appendStreamingText, setActiveStream, updateActiveStream, useActiveStream } from "@/lib/active-stream";
import { clearDraft, getUserPrefs, setUserPrefs } from "@/lib/chat-cache";
import { useDraft } from "@/lib/use-draft";
import { mayekClass } from "@/lib/script";

type Msg = { id: string; role: "user" | "assistant" | "system"; content: string; created_at?: string };

function isPersistedMessageId(id: string) {
  return !id.startsWith("u-") && !id.startsWith("a-") && !id.startsWith("opt-");
}

// Single source of truth for message order. Edit-and-resend needs the exact
// order the user sees to work out which rows come after the edited one, so this
// cannot live inline in the render body.
function sortMessages(msgs: Msg[]): Msg[] {
  return [...msgs].sort((a, b) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (timeA !== timeB) return timeA - timeB;
    // User always before assistant when timestamps match.
    if (a.role !== b.role) return a.role === "user" ? -1 : 1;
    // Deterministic final tie-breaker.
    return a.id.localeCompare(b.id);
  });
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
  /** Set when a new message failed to send, so it can be retried or edited. */
  const [failed, setFailed] = useState<{ text: string; images: string[]; message: string } | null>(null);
  // NOTE: there is deliberately no local `streaming` state. The cross-route
  // store is the single source of truth for in-flight text. Keeping a second
  // copy meant two React updates per chunk (one of which bypassed the store's
  // frame coalescing) and two render paths that could disagree.
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  // Rows a regenerate/edit is replacing. They stay in the database (and in the
  // query cache) until the replacement lands — this only hides them, so a
  // failed or stopped attempt restores them by clearing this list.
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);


  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // Synchronous double-send guard. `sending` is React state, so two clicks in
  // the same tick both read it as false — which started two turns claiming the
  // same `replaceIds` (both racing to delete the same rows) and left the first
  // stream with no way to be stopped, since the second overwrote `abortRef`.
  const inFlightRef = useRef(false);
  const qc = useQueryClient();
  const active = useActiveStream();

  // Keep the active stream authoritative for this chat until the database rows
  // have had time to settle. This prevents long replies from clearing during
  // route changes or refetches.
  const activeForChat = active && active.chatId === chatId ? active : null;
  const inflight = activeForChat && !activeForChat.done ? activeForChat : null;

  // A half-written reply survives switching to another chat and back. Keyed by
  // chat, so each conversation keeps its own unsent message.
  useDraft(chatId, input, setInput);

  // Turn bookkeeping lives in the cross-route active-stream store (see
  // `baseCount`), never in a ref — a ref resets on remount/navigation and used
  // to make the finished turn render twice (DB row + carryover).


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

  // Once the database has the completed turn, drop the cross-route store.
  useEffect(() => {
    if (!activeForChat?.done) return;
    const rows = messagesQ.data ?? [];
    // Rows being replaced don't count — they are still in the database until the
    // delete lands, and counting them cleared the carryover before the
    // replacement turn had been refetched, flashing an empty exchange.
    const persistedCount = rows.filter(
      (m) => isPersistedMessageId(m.id) && !hiddenIds.includes(m.id),
    ).length;
    if (persistedCount <= activeForChat.baseCount) return;
    const timer = window.setTimeout(() => setActiveStream(null), 60);
    return () => window.clearTimeout(timer);
  }, [activeForChat, messagesQ.data, hiddenIds]);


  // (No extra invalidate here — runSend already refreshes the message list once.
  // A second invalidate caused an extra refetch and a visible flash.)


  useEffect(() => {
    inputRef.current?.focus();
  }, [chatId]);

  // The composer grows with drafts and attachments. Keep the scroll tail tied
  // to its real rendered height rather than assuming a one-line input.
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const measure = () => setComposerHeight(Math.ceil(composer.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);


  const checkScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 80;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    setIsFollowingLatest(isAtBottom);
  };

  useEffect(() => {
    if (isFollowingLatest && (sending || generatingImage || inflight)) {
      const container = scrollContainerRef.current;
      if (container) {
        // Wait for the new turn and measured tail spacer to enter layout, then
        // pin the scroll container itself (never the browser window) to its end.
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    }
  }, [sending, generatingImage, inflight, inflight?.streaming, composerHeight, isFollowingLatest]);

  const scrollToBottom = () => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
    setIsFollowingLatest(true);
  };


  /**
   * Send a turn.
   *
   * `replaceIds` are persisted rows this turn supersedes (regenerate /
   * edit-and-resend). They are NOT deleted up front: the server is told to hide
   * them from the model's history, and they are removed only once the
   * replacement turn is confirmed in the database. If the request fails or is
   * stopped, the originals are still there.
   */
  const runSend = async (text: string, imgs: string[] = [], replaceIds: string[] = []) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setFailed(null);
    // Persist prefs
    setUserPrefs({ lang, mode });

    setSending(true);
    const imgTags = imgs.map((u) => `![image](${u})`).join("\n");
    const stored = text ? (imgTags ? `${imgTags}\n\n${text}` : text) : imgTags;

    const startMessages = qc.getQueryData<Msg[]>(["messages", chatId]) ?? [];
    // Rows being replaced are still in the database but are hidden from the UI
    // for the duration of the turn, so they must not count towards baseCount —
    // otherwise the carryover/persisted handoff miscounts and the turn renders
    // twice or flashes empty.
    const replaceSet = new Set(replaceIds);
    const startIds = new Set(
      startMessages.filter((m) => isPersistedMessageId(m.id)).map((m) => m.id),
    );
    const baseCount = startMessages.filter(
      (m) => isPersistedMessageId(m.id) && !replaceSet.has(m.id),
    ).length;

    // The carryover block below is the single source of truth for this turn's
    // user bubble + assistant reply. No optimistic rows are pushed into the
    // query cache, so the persisted rows can never render alongside it.
    setActiveStream({
      chatId,
      timestamp: Date.now(),
      baseCount,
      userText: stored,
      userImages: imgs,
      streaming: "",
      generatingImage: false,
      done: false,
    });


    // Hide the superseded rows optimistically. Nothing is deleted yet.
    if (replaceIds.length) setHiddenIds(replaceIds);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await streamChat({
        chatId,
        message: text,
        images: imgs,
        language: lang,
        mode,
        omitMessageIds: replaceIds,
        signal: controller.signal,
        onChunk: (delta) => {
          appendStreamingText(delta);
        },
      });

      // Delete the superseded rows only after confirming the replacement is
      // actually in the database. The server persists on every exit path
      // (including a stop), but its insert can still fail — trusting the
      // streamed text alone would delete a good answer and leave nothing.
      if (replaceIds.length) {
        const { data: fresh, error: readErr } = await supabase
          .from("messages")
          .select("id, role")
          .eq("chat_id", chatId);
        // A brand-new assistant row is the proof the replacement turn saved.
        const replacementLanded =
          !readErr &&
          (fresh ?? []).some(
            (r) => r.role === "assistant" && !startIds.has(r.id) && !replaceSet.has(r.id),
          );

        if (replacementLanded) {
          const { error } = await supabase.from("messages").delete().in("id", replaceIds);
          if (error) {
            // Keeping both copies is strictly better than losing the reply.
            toast.error("Couldn't remove the previous version — it's still in this chat.");
          }
        } else {
          // No replacement was saved. Restore the originals untouched. A
          // deliberate stop before any text arrived is not an error — the
          // "Stopped" toast below already covers it.
          if (!result.aborted) {
            toast.error("Couldn't save the new reply — your original message is unchanged.");
          }
        }
      }

      if (result.aborted) toast.message("Stopped");

      if (!result.reply.trim()) {
        // Nothing was generated (stopped instantly, or an empty response). Drop
        // the carryover — leaving it in place with `done: true` and no text left
        // an empty assistant bubble on screen that nothing ever cleared.
        setActiveStream(null);
      } else {
        // Mark the turn finished. The carryover keeps rendering the completed
        // reply (no blink) and is cleared by the effect above only once the
        // persisted rows for this turn are in the query cache.
        updateActiveStream({ done: true, streaming: result.reply });
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["messages", chatId] }),
        qc.invalidateQueries({ queryKey: ["chats"] }),
      ]);

      setHiddenIds([]);
    } catch (err) {
      // Nothing was deleted, so restoring the originals is just un-hiding them.
      setHiddenIds([]);
      const message = err instanceof Error ? err.message : "Failed to send";
      if (replaceIds.length) {
        // Regenerate and edit-and-resend still have their originals on screen,
        // so there is nothing to hand back — a toast is the whole story.
        toast.error(message);
      } else {
        // A new message, on the other hand, was cleared from the composer before
        // the request went out. Hand it back with a way to retry instead of
        // losing it to a toast that disappears in four seconds.
        setFailed({ text, images: imgs, message });
      }
      setActiveStream(null);
      // The server may still have saved a partial turn before the failure.
      await qc.invalidateQueries({ queryKey: ["messages", chatId] });
    } finally {
      abortRef.current = null;
      inFlightRef.current = false;
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if ((!text && images.length === 0) || sending) return;
    // Sending is an explicit request to follow the new turn. This overrides a
    // previous manual scroll-up so the new message lands above the tail space.
    setIsFollowingLatest(true);
    const sentImages = images;
    const imgTags = sentImages.map((u) => `![image](${u})`).join("\n");
    const stored = text ? (imgTags ? `${imgTags}\n\n${text}` : text) : imgTags;
    setInput("");
    setImages([]);
    clearDraft(chatId);

    // Auto-detect image intent — generate inline in the current chat
    const imageRequest = text && sentImages.length === 0 ? parseImageRequest(text) : null;
    if (imageRequest) {
      // This branch does not go through `runSend`, so it needs the same
      // synchronous guard — otherwise a double submit bills two generations and
      // inserts two copies of the same prompt.
      if (inFlightRef.current) return;
      inFlightRef.current = true;
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
        // Drop the optimistic row. Without this refetch the phantom user message
        // stayed in the cache, showing a prompt that was never saved.
        await qc.invalidateQueries({ queryKey: ["messages", chatId] });
      } finally {
        inFlightRef.current = false;
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

  const retryFailed = () => {
    if (!failed || sending) return;
    void runSend(failed.text, failed.images);
  };

  /** Puts the failed message back in the composer so it can be edited first. */
  const editFailed = () => {
    if (!failed) return;
    setInput(failed.text);
    setImages(failed.images);
    setFailed(null);
    inputRef.current?.focus();
  };

  const regenerate = async () => {
    if (sending) return;
    // Take the last exchange in display order — the previous version scanned an
    // unsorted array, so with colliding timestamps it could pick the wrong rows.
    const ordered = sortMessages((messagesQ.data ?? []).filter((m) => isPersistedMessageId(m.id)));
    const lastUserIdx = ordered.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) return;
    const lastUser = ordered[lastUserIdx];
    // Everything from that question onwards is what gets replaced.
    const replaceIds = ordered.slice(lastUserIdx).map((m) => m.id);
    await runSend(lastUser.content, [], replaceIds);
  };

  const editAndResend = async (msg: Msg, newText: string) => {
    if (sending) return;
    const trimmed = newText.trim();
    if (!trimmed) return;
    // Replace by id, taken from the sorted list. The old code deleted with
    // `.gte("created_at", cutoff)`, which also removed rows that merely shared a
    // timestamp with the edited message — and it deleted them before the
    // replacement existed, so a failure lost the whole tail of the chat.
    const ordered = sortMessages((messagesQ.data ?? []).filter((m) => isPersistedMessageId(m.id)));
    const idx = ordered.findIndex((m) => m.id === msg.id);
    const replaceIds = idx === -1 ? [msg.id] : ordered.slice(idx).map((m) => m.id);
    await runSend(trimmed, [], replaceIds);
  };

  // Collapsed to one scalar so the memo below depends on exactly what matters:
  // null = no turn in flight for this chat, otherwise the row count it started
  // from. Text growth deliberately does not appear here.
  const activeBaseCount = activeForChat ? activeForChat.baseCount : null;

  // The whole list derivation is memoised: without this it re-ran on every
  // streamed frame, re-sorting and re-mapping the entire conversation just to
  // render one growing bubble. In a long chat that dominated the frame budget.
  const { renderedMessages, sortedMessages, turnPersisted } = useMemo(() => {
    // Rows a regenerate/edit is superseding are hidden, not deleted.
    const hidden = hiddenIds.length ? new Set(hiddenIds) : null;
    const all = messagesQ.data ?? [];
    const msgs = hidden ? all.filter((m) => !hidden.has(m.id)) : all;

    // Persisted rows only (never the transient image-generation optimistic row).
    const persisted = msgs.filter((m) => isPersistedMessageId(m.id));

    // A turn has landed once the database holds more rows than when it started.
    // `baseCount` lives in the cross-route store, so this stays correct across
    // remounts/navigation — the old ref-based version reset to null on remount
    // and let the persisted reply render *and* the carryover render.
    const landed = activeBaseCount === null || persisted.length > activeBaseCount;

    // While a turn is in flight, the carryover owns it; the DB list is truncated
    // to the rows that existed before the turn (identical past messages stay).
    const baseMsgs = landed ? msgs : persisted.slice(0, activeBaseCount);

    // Deduplicate strictly by message id.
    const byId = new Map<string, Msg>();
    baseMsgs.forEach((m) => byId.set(m.id, m));

    const rendered = Array.from(byId.values()).filter(
      (m) => !m.id.startsWith("opt-") || sending,
    );
    return {
      renderedMessages: rendered,
      sortedMessages: sortMessages(rendered),
      turnPersisted: landed,
    };
  }, [messagesQ.data, hiddenIds, activeBaseCount, sending]);

  const canRegenerate = !sending && !inflight && renderedMessages.some((m) => m.role === "assistant");

  // `editAndResend` is rebuilt on every render, which would defeat memo() on
  // every row. Route the latest one through a ref so the prop identity is fixed.
  const editRef = useRef(editAndResend);
  editRef.current = editAndResend;
  const onEditStable = useCallback(
    (msg: Msg, newText: string) => editRef.current(msg, newText),
    [],
  );

  // Only show the carryover while the turn is not yet persisted.
  const showCarryover = activeForChat && !turnPersisted ? activeForChat : null;

  /*
   * A screen reader was told when a reply *started* — ThinkingLoader is a polite
   * live region — but never when one finished. The announcement simply stopped,
   * which is indistinguishable from a request that died silently. Announce the
   * transition out of `sending` instead, so the outcome is spoken either way.
   *
   * The streamed text itself is deliberately not in a live region: announcing
   * every token would talk over the user for the whole response.
   */
  const [srAnnouncement, setSrAnnouncement] = useState("");
  const wasSending = useRef(false);
  useEffect(() => {
    if (sending) {
      wasSending.current = true;
      return;
    }
    if (!wasSending.current) return;
    wasSending.current = false;
    setSrAnnouncement(failed ? "That message didn't send." : "Response ready.");
  }, [sending, failed]);





  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      <p aria-live="polite" className="sr-only">
        {srAnnouncement}
      </p>
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" onScroll={checkScroll}>
        <div className="mx-auto max-w-3xl px-3 py-6 sm:px-4 md:px-6 md:py-8">
          {/*
            The history fetch had no loading or error state at all: opening a chat
            showed an empty column that suddenly filled, and a failed fetch showed
            the same empty column forever with no way to retry.
          */}
          {messagesQ.isPending && !showCarryover && (
            <div className="space-y-7" role="status" aria-label="Loading conversation">
              <div className="flex justify-end">
                <div className="shimmer h-14 w-2/3 rounded-2xl rounded-br-md" />
              </div>
              <div className="flex gap-3 md:gap-4">
                <div className="shimmer h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2.5 pt-1">
                  <div className="shimmer h-3.5 w-full rounded" />
                  <div className="shimmer h-3.5 w-11/12 rounded" />
                  <div className="shimmer h-3.5 w-4/5 rounded" />
                </div>
              </div>
            </div>
          )}
          {messagesQ.isError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
              <p className="font-medium">Couldn't load this conversation.</p>
              <p className="mt-1 text-muted-foreground">
                Your messages are safe — this is a connection problem, not a lost chat.
              </p>
              <Button variant="outline" size="sm" onClick={() => messagesQ.refetch()} className="mt-3 h-9">
                Try again
              </Button>
            </div>
          )}
          {sortedMessages.map((msg) => (
            <MessageRow
              key={`msg-${msg.id}`}
              message={msg}
              chatId={chatId}
              lang={lang}
              onEdit={onEditStable}
              disabled={sending}
            />
          ))}
          {showCarryover && (
            <div className="msg-in">
              <div className="mb-7 flex justify-end">
                <div
                  className={`max-w-[92%] rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-secondary-foreground sm:max-w-[85%] ${mayekClass(showCarryover.userText) ?? ""}`}
                >
                  {showCarryover.userImages && showCarryover.userImages.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {showCarryover.userImages.map((src, i) => (
                        <div key={i} className="h-16 w-16 overflow-hidden rounded-lg border border-border">
                          <img src={src} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                    {showCarryover.userText.replace(/!\[[^\]]*\]\([^)]+\)\n?/g, "").trim() || (showCarryover.userImages?.length ? "" : "(image)")}
                  </p>
                </div>
              </div>

              <div className="flex gap-3 md:gap-4">
                <AssistantMark />
                <div className="min-w-0 flex-1 pt-0.5">
                  {showCarryover.generatingImage ? (
                    <ImageGeneratingAnimation />
                  ) : showCarryover.streaming || showCarryover.done ? (
                    <Suspense fallback={<div className="shimmer h-20 w-full rounded" />}>
                      {/* The caret after the trailing paragraph is the signal that
                          text is still arriving. */}
                      <div className={!showCarryover.done ? "streaming-tail" : undefined}>
                        <StreamingAssistantContent content={showCarryover.streaming} />
                      </div>
                    </Suspense>
                  ) : (
                    <ThinkingLoader />
                  )}
                </div>
              </div>
            </div>
          )}
          {/* Image generation does not use the cross-route store, so it needs
              its own pending block. */}
          {sending && !activeForChat && (
            <div className="msg-in flex gap-3 md:gap-4">
              <AssistantMark />
              <div className="min-w-0 flex-1 pt-0.5">
                {generatingImage ? <ImageGeneratingAnimation /> : <ThinkingLoader />}
              </div>
            </div>
          )}
          {failed && (
            <div className="msg-in">
              <div className="mb-4 flex justify-end">
                <div
                  className={`max-w-[92%] rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-secondary-foreground sm:max-w-[85%] ${mayekClass(failed.text) ?? ""}`}
                >
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                    {failed.text || "(image)"}
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
                <p className="font-medium">That message didn't send.</p>
                <p className="mt-1 text-muted-foreground">{failed.message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={retryFailed} disabled={sending} className="h-9 gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Try again
                  </Button>
                  <Button variant="outline" size="sm" onClick={editFailed} className="h-9">
                    Edit the message
                  </Button>
                </div>
              </div>
            </div>
          )}

          {canRegenerate && !failed && (
            <div className="mt-5 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={regenerate}
                className="h-9 gap-1.5 rounded-full px-4 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Regenerate reply
              </Button>
            </div>
          )}

          <div ref={bottomRef} />
          {/*
            A real scrollable tail, not page padding. On phones it combines the
            measured composer with viewport-relative breathing room; the safe
            area remains available even when the composer changes height.
          */}
          <div
            aria-hidden="true"
            className="h-[calc(var(--composer-height)+clamp(12rem,28svh,18rem)+env(safe-area-inset-bottom))] sm:h-[calc(var(--composer-height)+clamp(6rem,16svh,10rem))]"
            style={{ "--composer-height": `${composerHeight}px` } as CSSProperties}
          />
        </div>
      </div>

      {/*
        Anchored to the composer's top edge instead of a hardcoded `bottom-32`,
        which drifted out of place as soon as the composer grew — with
        attachments or a multi-line draft it ended up floating over the input.
      */}
      {!isFollowingLatest && (sending || inflight) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={scrollToBottom}
            className="pointer-events-auto animate-in fade-in slide-in-from-bottom-2 gap-2 rounded-full border border-border px-4 shadow-soft"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
            Jump to latest
          </Button>
        </div>
      )}

      <Composer
        containerRef={composerRef}
        input={input}
        setInput={setInput}
        images={images}
        setImages={setImages}
        onSubmit={submit}
        sending={sending || Boolean(inflight)}
        inputRef={inputRef}
        lang={lang}
        setLang={setLang}
        mode={mode}
        setMode={setMode}
        // Only offered when this route actually owns an abortable stream.
        // `inflight` belongs to another route and image generation has no
        // controller, so neither gets a Stop button that would do nothing.
        onStop={sending && !generatingImage ? stop : undefined}
      />
    </div>
  );
}

/**
 * The ꯃ mark. Renders from --font-sans, which now carries Noto Sans Meetei Mayek
 * as a fallback — on iOS and macOS, which ship no Meetei Mayek face, this was a
 * tofu box where the brand mark should be.
 */
function AssistantMark() {
  return (
    <div
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-base font-semibold leading-none text-primary-foreground"
      aria-hidden="true"
    >
      ꯃ
    </div>
  );
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
        <div className="flex flex-wrap gap-1.5">
          {imgs.map((p, i) => (
            <a key={i} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border" aria-label={`Open attachment ${i + 1} in a new tab`}>
              <img src={p.url} alt={`Attachment ${i + 1}`} loading="lazy" decoding="async" sizes="(max-width: 640px) 60vw, 220px" className="max-h-64 max-w-[220px] object-cover" />
            </a>
          ))}
        </div>
      )}
      {texts.length > 0 && (
        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{texts.map((t) => t.text).join("\n\n")}</p>
      )}
    </div>
  );
}


/**
 * Memoised: a streamed reply re-renders the route on every frame, and without
 * this every message in the conversation re-rendered with it (each one carrying
 * its own state, a `useServerFn` binding and a markdown render). All five props
 * are referentially stable — `message` comes straight from the query cache and
 * `onEdit` is ref-wrapped by the caller.
 */
const MessageRow = memo(function MessageRow({
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

  // Stop playback when this row goes away (chat switch, or the row being
  // replaced by a regenerate). `ttsStateRef` keeps the cleanup out of the
  // dependency list so it still runs exactly once, on unmount.
  const ttsStateRef = useRef(ttsState);
  ttsStateRef.current = ttsState;
  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
      // The browser speech path was never cancelled, so it kept talking after
      // navigating away. Only cancel if *this* row was the one speaking —
      // speechSynthesis is global and shared with every other row.
      if (ttsStateRef.current === "playing" && typeof window !== "undefined") {
        window.speechSynthesis?.cancel();
      }
    },
    [],
  );

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

  /*
   * Actions are 36px on touch and shrink to 28px on desktop, where a mouse can
   * hit a smaller target. They were 24px everywhere — under the 44px guideline
   * on the device where most of this is read.
   *
   * They fade in on hover on desktop, but `group-focus-within` was missing, so
   * tabbing into them left them invisible while focused: you could hear the
   * button in a screen reader and see nothing on screen.
   */
  const actionBtn =
    "h-9 w-9 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:h-7 md:w-7";
  const actionGroup =
    "flex items-center gap-0.5 transition-opacity md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100";

  return (
    <>
      <div className="msg-in group/row mb-7">
        {editing ? (
          /* The editor spans the column instead of sitting inside the bubble's
             padding — a `min-w-[300px]` box nested in a right-aligned bubble
             overflowed the viewport on a phone. */
          <div className="rounded-2xl border border-border bg-card p-3 shadow-soft">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(10, Math.max(2, draft.split("\n").length))}
              className="min-h-20 resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
              aria-label="Edit your message"
              autoFocus
              onKeyDown={(e) => {
                // Same IME guard as the composer: committing a Meitei Mayek
                // candidate with Enter must not submit the edit.
                if ((e.nativeEvent as KeyboardEvent).isComposing) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void saveEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
            />
            <div className="mt-2.5 flex items-center justify-end gap-2">
              <span className="mr-auto hidden text-[11px] text-muted-foreground sm:block">
                Enter to resend · Shift+Enter for a new line
              </span>
              <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-9 px-3 text-xs">
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={disabled} className="h-9 px-4 text-xs">
                Resend
              </Button>
            </div>
          </div>
        ) : isUser ? (
          /* No "You" avatar. It was a 32px box plus a 12px gap of pure
             decoration on the side of the screen with the least room — the
             right-aligned bubble already says who is speaking. */
          <div className="flex justify-end">
            <div
              className={`max-w-[92%] rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-secondary-foreground sm:max-w-[85%] ${mayekClass(message.content) ?? ""}`}
            >
              <UserContent content={message.content} />
            </div>
          </div>
        ) : (
          <div className="flex gap-3 md:gap-4">
            <AssistantMark />
            {/* No bubble on the assistant side: replies are long-form, and a
                container around a 900-word answer only narrows the measure. */}
            <div className="min-w-0 flex-1 pt-0.5">
              {(() => {
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
          </div>
        )}

        {!editing && (
          /* Assistant actions indent to sit under the text column (32px mark +
             gap), so the row lines up with the reply rather than the avatar. */
          <div
            className={`mt-1 flex items-center gap-1 text-[11px] text-muted-foreground ${isUser ? "justify-end" : "pl-11 md:pl-12"}`}
          >
            <div className={actionGroup}>
              {isUser ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={startEdit}
                  disabled={disabled}
                  className={actionBtn}
                  aria-label="Edit and resend this message"
                  title="Edit and resend"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={actionBtn}
                    onClick={copy}
                    aria-label={copied ? "Reply copied" : "Copy reply"}
                    title="Copy reply"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-gold" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={actionBtn}
                    onClick={speak}
                    disabled={ttsState === "loading"}
                    aria-label={ttsState === "playing" ? "Stop reading aloud" : "Read aloud in Manipuri"}
                    title={ttsState === "playing" ? "Stop reading" : "Read aloud in Manipuri"}
                  >
                    {ttsState === "loading" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : ttsState === "playing" ? (
                      <Square className="h-3.5 w-3.5 fill-current" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={actionBtn}
                    onClick={openCorrection}
                    aria-label="Suggest a Manipuri correction"
                    title="Suggest a Manipuri correction"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
            <span className="px-1">{formatTime(message.created_at)}</span>
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
            <Button onClick={submitCorrection} disabled={savingCorrection || !correction.trim()}>
              {savingCorrection ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
