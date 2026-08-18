import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { streamChat } from "@/lib/chat-stream";
import { generateImages, parseImageRequest } from "@/lib/image-gen";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Composer, ImageGeneratingAnimation, StreamingAssistantContent, ThinkingLoader } from "@/components/chat-shared";
import { getCachedResponse, setCachedResponse, getUserPrefs, setUserPrefs } from "@/lib/chat-cache";
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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const active = useActiveStream();
  // Keep the pending preview visible on /chat for the entire stream. The
  // server sends chatId almost immediately, but we intentionally navigate only
  // after the reply finishes; hiding this when chatId arrives made long replies
  // disappear until refresh.
  const pendingHere = active;

  useEffect(() => { inputRef.current?.focus(); }, []);
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
    if (isFollowingLatest && (pendingHere?.streaming || pendingHere?.generatingImage)) {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [pendingHere?.streaming, pendingHere?.generatingImage, isFollowingLatest]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if ((!text && images.length === 0) || sending) return;
    
    // Persist prefs on use
    setUserPrefs({ lang, mode });

    setSending(true);
    const sentImages = images;
    const imgTags = sentImages.map((u) => `![image](${u})`).join("\n");
    const stored = text ? (imgTags ? `${imgTags}\n\n${text}` : text) : imgTags;
    const imageRequest = text && sentImages.length === 0 ? parseImageRequest(text) : null;
    
    // Check Cache (DISABLED per user request to avoid "edit and fuck up" behavior)
    const hasImages = sentImages.length > 0;
    const cached = null; // getCachedResponse(text) disabled


    // Instantly reflect the message in the UI and clear the composer.
    setInput("");
    setImages([]);
    setActiveStream({
      chatId: "pending", // Mark as pending to differentiate from null/stale
      userText: stored,
      userImages: sentImages,
      streaming: cached || "",
      generatingImage: Boolean(imageRequest),
      done: Boolean(cached),
    });

    if (cached) {
      setSending(false);
      // Wait for chatId from server to persist if needed, or just let it be ephemeral.
      // But user requested instant UI skip loading state.
    }
    
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
      
      if (cached) {
        // We still need to call the API to create the chat and save the turn in background
        // but we've already shown the result.
        // For simplicity in this implementation, if cached, we just treat it as a background save.
        // A full implementation would handle chatId mapping.
      }

      await streamChat({
        chatId: null,
        message: text,
        images: sentImages,
        language: lang,
        mode,
        onMeta: (m) => {
          receivedChatId = m.chatId;
          updateActiveStream({ chatId: m.chatId });
        },
        onChunk: (delta) => {
          if (cached) return; // Don't append if we already have it
          acc += delta;
          appendStreamingText(delta);
        },
      });

      if (!cached && acc) {
        setCachedResponse(text, acc);
      }
      
      const finalChatId = receivedChatId;
      if (finalChatId) {
        qc.setQueryData(["messages", finalChatId], [
          { id: "u-1", role: "user", content: stored, created_at: new Date().toISOString() },
          { id: "a-1", role: "assistant", content: acc, created_at: new Date().toISOString() },
        ]);
        qc.invalidateQueries({ queryKey: ["chats"] });
        updateActiveStream({ done: true, chatId: finalChatId });
        
        // Use a small delay before navigation to ensure the state is fully 
        // committed and avoid a "double blink" during transition.
        setTimeout(() => {
          navigate({ to: "/chat/$chatId", params: { chatId: finalChatId } });
        }, 10);
      } else {
        updateActiveStream({ done: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setActiveStream(null);
    } finally {
      setSending(false);
    }
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

  const [randomSuggestions, setRandomSuggestions] = useState<typeof suggestions>([]);

  useEffect(() => {
    const shuffled = [...suggestions].sort(() => 0.5 - Math.random());
    setRandomSuggestions(shuffled.slice(0, 4));
  }, []);


  return (
    <div className="flex h-full flex-col">

        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto"
          onScroll={checkScroll}
        >
          <div className={`mx-auto ${pendingHere ? "" : "flex min-h-full flex-col"} max-w-2xl px-4 py-4 sm:py-10`}>
            {!pendingHere && (
              <>
                <div className="text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white text-black text-2xl leading-none font-semibold shadow-glow" aria-hidden="true">
                    ꯃ
                  </div>
                  <h1 className="mt-3 font-display text-2xl font-bold text-white sm:mt-5 sm:text-3xl">How can I help you today?</h1>
                  <p className="mt-2 text-sm text-neutral-400">
                    Write in Manipuri or English — attach photos of homework, math, docs, or screenshots and I'll answer based on them.
                  </p>
                </div>

                <div className="mt-6 grid gap-2 sm:mt-8 sm:grid-cols-2">
                  {randomSuggestions.map((s) => (
                    <button
                      key={s.title}
                      onClick={() => { setInput(s.prompt); inputRef.current?.focus(); }}
                      className="rounded-xl border border-white/10 bg-neutral-900 p-3 text-left text-sm shadow-soft transition-colors hover:border-white/30 hover:bg-neutral-800 hidden sm:block"
                    >
                      <div className="font-medium text-white text-xs sm:text-sm">{s.title}</div>
                      <div className="mt-0.5 truncate text-[10px] sm:text-xs text-neutral-500">{s.prompt}</div>
                    </button>
                  ))}
                  {randomSuggestions.slice(0, 2).map((s) => (
                    <button
                      key={`mob-${s.title}`}
                      onClick={() => { setInput(s.prompt); inputRef.current?.focus(); }}
                      className="rounded-xl border border-white/10 bg-neutral-900 p-3 text-left text-sm shadow-soft transition-colors hover:border-white/30 hover:bg-neutral-800 sm:hidden"
                    >
                      <div className="font-medium text-white text-xs">{s.title}</div>
                      <div className="mt-0.5 truncate text-[10px] text-neutral-500">{s.prompt}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {pendingHere && (
              <div>
                <div className="my-6 flex flex-row-reverse items-start gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-800 text-neutral-400 text-xs font-semibold">You</div>
                  <div className="inline-block max-w-[85%] rounded-2xl rounded-tr-md bg-neutral-900 px-4 py-2.5 text-white">
                    <p className="whitespace-pre-wrap text-sm text-foreground/90">{pendingHere.userText.replace(/!\[[^\]]*\]\([^)]+\)\n?/g, "").trim() || "(image)"}</p>
                  </div>
                </div>
                <div className="my-6 flex items-start gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-black text-base leading-none font-semibold" aria-hidden="true">ꯃ</div>
                  <div className="min-w-0 flex-1">
                    {pendingHere.generatingImage ? (
                      <ImageGeneratingAnimation />
                    ) : (pendingHere.streaming || pendingHere.done) ? (
                      <StreamingAssistantContent content={pendingHere.streaming} />
                    ) : (
                      <ThinkingLoader />
                    )}
                  </div>
                </div>
                <div ref={bottomRef} />
              </div>
            )}
          </div>

        </div>

        <Composer
          input={input} setInput={setInput}
          images={images} setImages={setImages}
          onSubmit={submit} sending={sending} inputRef={inputRef}
          lang={lang} setLang={setLang} mode={mode} setMode={setMode}
        />
      </div>
  );
}


