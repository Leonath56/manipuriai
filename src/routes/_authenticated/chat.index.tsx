import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect, type CSSProperties } from "react";
import { streamChat } from "@/lib/chat-stream";
import { generateImages, parseImageRequest } from "@/lib/image-gen";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { Composer, ImageGeneratingAnimation, StreamingAssistantContent, ThinkingLoader } from "@/components/chat-shared";
import { clearDraft, getUserPrefs, setUserPrefs } from "@/lib/chat-cache";
import { NEW_CHAT_DRAFT_KEY, useDraft } from "@/lib/use-draft";
import { mayekClass } from "@/lib/script";
import {
  appendStreamingText,
  setActiveStream,
  updateActiveStream,
  useActiveStream,
} from "@/lib/active-stream";

export const Route = createFileRoute("/_authenticated/chat/")({
  head: () => ({ meta: [{ title: "New chat — Manipuri AI" }, { name: "description", content: "Start a new Manipuri AI conversation in Meiteilon, Meitei Mayek script or English with streaming replies." }, { name: "robots", content: "noindex, nofollow" }] }),
  component: NewChat,
});


function NewChat() {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [lang, setLang] = useState<"auto" | "mni" | "mni-mtei" | "en">(() => getUserPrefs()?.lang ?? "auto");
  const [mode, setMode] = useState<"instant" | "think">(() => getUserPrefs()?.mode ?? "instant");
  const [sending, setSending] = useState(false);
  /** Set when a send failed outright, so the message can be retried or edited. */
  const [failed, setFailed] = useState<{ text: string; images: string[]; message: string } | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // Synchronous double-send guard. `sending` is React state, so two submits in
  // the same tick both read it as false — which created two chats from one
  // prompt and left the first stream unstoppable (the second overwrote
  // `abortRef`).
  const inFlightRef = useRef(false);
  const active = useActiveStream();
  // Keep the pending preview visible on /chat for the entire stream. The
  // server sends chatId almost immediately, but we intentionally navigate only
  // after the reply finishes; hiding this when chatId arrives made long replies
  // disappear until refresh.
  const pendingHere = active;

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const measure = () => setComposerHeight(Math.ceil(composer.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);

  // Keeps a half-written first message across navigation to /image, /voice or a
  // different chat and back.
  useDraft(NEW_CHAT_DRAFT_KEY, input, setInput);

  const stop = () => {
    abortRef.current?.abort();
  };

  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const checkScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const threshold = 80;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    setIsFollowingLatest(isAtBottom);
  };

  useEffect(() => {
    if (isFollowingLatest && pendingHere) {
      const container = scrollContainerRef.current;
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    }
  }, [pendingHere, pendingHere?.streaming, pendingHere?.generatingImage, composerHeight, isFollowingLatest]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if ((!text && images.length === 0) || sending) return;
    if (inFlightRef.current) return;

    setIsFollowingLatest(true);
    const sentImages = images;
    // Instantly reflect the message in the UI and clear the composer.
    setInput("");
    setImages([]);
    clearDraft(NEW_CHAT_DRAFT_KEY);
    await runSend(text, sentImages);
  };

  /*
   * The send itself, split out from the submit handler so `retry` can re-run it
   * with the same text and images. A failed request used to end with an error
   * toast and an empty composer — the message was simply gone, and the only way
   * to try again was to type the whole thing a second time.
   */
  const runSend = async (text: string, sentImages: string[]) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setFailed(null);

    // Persist prefs on use
    setUserPrefs({ lang, mode });

    setSending(true);
    const imgTags = sentImages.map((u) => `![image](${u})`).join("\n");
    const stored = text ? (imgTags ? `${imgTags}\n\n${text}` : text) : imgTags;
    const imageRequest = text && sentImages.length === 0 ? parseImageRequest(text) : null;

    setActiveStream({
      chatId: "pending", // Mark as pending to differentiate from null/stale
      timestamp: Date.now(),
      baseCount: 0, // brand-new chat: no persisted rows yet

      userText: stored,
      userImages: sentImages,
      streaming: "",
      generatingImage: Boolean(imageRequest),
      done: false,
    });

    try {
      // Auto-detect image generation intent (no images attached, text prompt)
      if (imageRequest) {
        const result = await generateImages({
          chatId: null,
          prompt: imageRequest.prompt,
          aspectRatio: imageRequest.aspectRatio,
          quality: "standard",
          count: 1,
          style: "none",
        });
        qc.invalidateQueries({ queryKey: ["chats"] });
        updateActiveStream({ chatId: result.chatId, done: true });
        navigate({ to: "/chat/$chatId", params: { chatId: result.chatId } });
        // Destination will clear activeStream once its messages query loads.
        return;
      }

      let acc = "";
      let receivedChatId: string | null = null;

      const controller = new AbortController();
      abortRef.current = controller;

      const result = await streamChat({
        chatId: null,
        message: text,
        images: sentImages,
        language: lang,
        mode,
        signal: controller.signal,
        onMeta: (m) => {
          receivedChatId = m.chatId;
          updateActiveStream({ chatId: m.chatId });
        },
        onChunk: (delta) => {
          acc += delta;
          appendStreamingText(delta);
        },
      });

      if (result.aborted) toast.message("Stopped");

      const finalChatId = receivedChatId;
      if (finalChatId && acc.trim()) {
        // Don't seed the cache with fake ids — the server has already saved the
        // real rows (it persists on every exit path, stop included), so let the
        // destination route read them. Writing `u-1`/`a-1` here meant a stopped
        // reply showed placeholder rows that never matched the database.
        qc.invalidateQueries({ queryKey: ["chats"] });
        updateActiveStream({ done: true, chatId: finalChatId, streaming: acc });

        navigate({ to: "/chat/$chatId", params: { chatId: finalChatId } });
      } else if (finalChatId) {
        // The chat row exists but nothing was generated (stopped immediately).
        // Go there anyway so the user isn't stranded, and let the route load
        // whatever the server saved.
        setActiveStream(null);
        qc.invalidateQueries({ queryKey: ["chats"] });
        navigate({ to: "/chat/$chatId", params: { chatId: finalChatId } });
      } else {
        // No chatId ever arrived, so nothing was saved and there is nowhere to
        // navigate. Clear the pending bubble instead of leaving it stuck.
        setActiveStream(null);
        if (!result.aborted) {
          setFailed({ text, images: sentImages, message: "Couldn't reach Manipuri AI." });
        }
      }
    } catch (err) {
      setActiveStream(null);
      setFailed({
        text,
        images: sentImages,
        message: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      abortRef.current = null;
      inFlightRef.current = false;
      setSending(false);
    }
  };

  const retry = () => {
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




  const suggestions = [
    { title: "Meiteilon homework mateng pangbiyu", prompt: "Explain this Meiteilon grammar for me." },
    { title: "Meitei Mayek script tamba", prompt: "How do I write my name in Meitei Mayek?" },
    { title: "Translate English to Manipuri", prompt: "Translate: 'May you have a wonderful day' into native Meiteilon." },
    { title: "Manipur-gi history wari", prompt: "Tell me an interesting story from Manipur's history." },
    { title: "Manipuri recipe thiba", prompt: "How to make Eromba step by step?" },
    { title: "Manipuri digital service helper", prompt: "Help me write a professional email in Meiteilon." },
    { title: "Deep thinking on Meiteilon culture", prompt: "What makes Manipuri culture unique in Northeast India?" },
    { title: "Instant facts about Imphal", prompt: "Tell me about the importance of Kangla Fort." },
  ];

  // Seeded with the first four rather than `[]`: the grid used to render empty on
  // first paint and then pop in after the effect, shifting the whole page down.
  const [randomSuggestions, setRandomSuggestions] = useState<typeof suggestions>(() => suggestions.slice(0, 4));

  useEffect(() => {
    const shuffled = [...suggestions].sort(() => 0.5 - Math.random());
    setRandomSuggestions(shuffled.slice(0, 4));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" onScroll={checkScroll}>
        <div className={`mx-auto ${pendingHere || failed ? "" : "flex min-h-full flex-col justify-start sm:justify-center"} max-w-3xl px-4 py-4 pt-6 sm:py-10`}>
          {!pendingHere && !failed && (
            <>
              <div className="text-center">
                <div
                  className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary text-2xl font-semibold leading-none text-primary-foreground shadow-glow"
                  aria-hidden="true"
                >
                  ꯃ
                </div>
                {/* Greets in Meiteilon first, then English. The product's whole
                    reason to exist is the language; the landing screen is where
                    that should be visible, not a generic "How can I help you". */}
                <h1 className="mt-3 font-display text-2xl font-semibold sm:mt-4 sm:text-3xl">
                  <span className="font-mayek">ꯈꯨꯔꯨꯝꯖꯔꯤ</span> — what can I help with?
                </h1>
                <p className="mx-auto mt-2.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Write in Manipuri, Meitei Mayek or English. Attach a photo of homework, a document
                  or a screenshot and I'll answer from it.
                </p>
              </div>

              {/*
                One list, not two. There used to be a desktop-only set of four and
                a mobile-only set of two rendered as separate loops — the same
                buttons twice in the DOM. Now the last two are hidden on small
                screens by class instead.
              */}
              <ul className="mt-6 grid gap-2 sm:mt-9 sm:grid-cols-2">
                {randomSuggestions.map((s, i) => (
                  <li key={s.title} className={i >= 2 ? "hidden sm:list-item" : undefined}>
                    <button
                      type="button"
                      onClick={() => { setInput(s.prompt); inputRef.current?.focus(); }}
                      className="h-full w-full rounded-xl border border-border bg-card p-3.5 text-left hover:border-gold/40 hover:bg-accent"
                    >
                      <span className="block text-sm font-medium">{s.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{s.prompt}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {failed && !pendingHere && (
            <div className="msg-in">
              {/* The message is still here. That is the whole point of this
                  card: a failed send used to clear the composer and leave a
                  toast that disappeared after four seconds. */}
              <div className="mb-4 flex justify-end">
                <div
                  className={`max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-secondary-foreground ${mayekClass(failed.text) ?? ""}`}
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
                  <Button size="sm" onClick={retry} disabled={sending} className="h-9 gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Try again
                  </Button>
                  <Button variant="outline" size="sm" onClick={editFailed} className="h-9">
                    Edit the message
                  </Button>
                </div>
              </div>
            </div>
          )}

          {pendingHere && (
            <div>
              <div className="msg-in mb-7 flex justify-end">
                <div
                  className={`max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-secondary-foreground ${mayekClass(pendingHere.userText) ?? ""}`}
                >
                  {pendingHere.userImages && pendingHere.userImages.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {pendingHere.userImages.map((src, i) => (
                        <div key={i} className="h-14 w-14 overflow-hidden rounded-lg border border-border">
                          <img src={src} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                    {pendingHere.userText.replace(/!\[[^\]]*\]\([^)]+\)\n?/g, "").trim() || (pendingHere.userImages?.length ? "" : "(image)")}
                  </p>
                </div>
              </div>
              <div className="msg-in flex items-start gap-3">
                <div
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-base font-semibold leading-none text-primary-foreground"
                  aria-hidden="true"
                >
                  ꯃ
                </div>
                <div className="min-w-0 flex-1">
                  {pendingHere.generatingImage ? (
                    <ImageGeneratingAnimation />
                  ) : pendingHere.streaming || pendingHere.done ? (
                    // `streaming-tail` draws the blinking caret after the last
                    // paragraph while text is still arriving.
                    <div className={!pendingHere.done ? "streaming-tail" : undefined}>
                      <StreamingAssistantContent content={pendingHere.streaming} />
                    </div>
                  ) : (
                    <ThinkingLoader />
                  )}
                </div>
              </div>
              <div ref={bottomRef} />
              <div
                aria-hidden="true"
                className="h-[calc(var(--composer-height)+clamp(12rem,28svh,18rem)+env(safe-area-inset-bottom))] sm:h-[calc(var(--composer-height)+clamp(6rem,16svh,10rem))]"
                style={{ "--composer-height": `${composerHeight}px` } as CSSProperties}
              />
            </div>
          )}
        </div>
      </div>

      <Composer
        containerRef={composerRef}
        input={input} setInput={setInput}
        images={images} setImages={setImages}
        onSubmit={submit} sending={sending} inputRef={inputRef}
        lang={lang} setLang={setLang} mode={mode} setMode={setMode}
        // Stop lives in the composer now, where the Send button was — it used to
        // be a centred outline button under the reply. Withheld during image
        // generation, which has no AbortController to cancel: offering a Stop
        // that silently does nothing is worse than not offering one.
        onStop={pendingHere?.generatingImage ? undefined : stop}
      />
    </div>
  );
}


