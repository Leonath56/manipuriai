import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";

import { streamChat } from "@/lib/chat-stream";
import { generateImages, parseImageRequest } from "@/lib/image-gen";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Composer, ImageGeneratingAnimation, StreamingAssistantContent } from "@/components/chat-shared";
import {
  appendStreamingText,
  setActiveStream,
  updateActiveStream,
  useActiveStream,
} from "@/lib/active-stream";

export const Route = createFileRoute("/_authenticated/chat/")({
  head: () => ({ meta: [{ title: "New chat — Manipuri AI" }] }),
  component: NewChat,
});


function NewChat() {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [lang, setLang] = useState<"auto" | "mni" | "mni-mtei" | "en">("auto");
  const [mode, setMode] = useState<"instant" | "think">("instant");
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const active = useActiveStream();
  // Only show the pending preview on this route when the stream has not
  // yet been assigned a chatId. Once it has, we navigate away and the
  // destination route renders the same stream from the same store.
  const pendingHere = active && active.chatId === null ? active : null;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [pendingHere?.streaming, pendingHere?.generatingImage]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if ((!text && images.length === 0) || sending) return;
    setSending(true);
    const sentImages = images;
    const imgTags = sentImages.map((u) => `![image](${u})`).join("\n");
    const stored = text ? (imgTags ? `${imgTags}\n\n${text}` : text) : imgTags;
    const imageRequest = text && sentImages.length === 0 ? parseImageRequest(text) : null;
    // Instantly reflect the message in the UI and clear the composer.
    setInput("");
    setImages([]);
    setActiveStream({
      chatId: null,
      userText: stored,
      userImages: sentImages,
      streaming: "",
      generatingImage: Boolean(imageRequest),
      done: false,
    });
    let navigated = false;
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
      await streamChat({
        chatId: null,
        message: text,
        images: sentImages,
        language: lang,
        mode,
        onMeta: (m) => {
          // The moment the server tells us the new chatId, navigate to the
          // destination route. Streaming continues in the background and
          // both routes read from the same shared store, so there is no
          // flicker or lost partial reply.
          updateActiveStream({ chatId: m.chatId });
          if (!navigated) {
            navigated = true;
            navigate({ to: "/chat/$chatId", params: { chatId: m.chatId } });
          }
        },
        onChunk: (delta) => {
          acc += delta;
          appendStreamingText(delta);
        },
      });
      // Stream complete — seed cache so the destination renders instantly.
      const { getActiveStream } = await import("@/lib/active-stream");
      const finalChatId = getActiveStream()?.chatId ?? null;
      if (finalChatId) {
        qc.setQueryData(["messages", finalChatId], [
          { id: "u-1", role: "user", content: stored, created_at: new Date().toISOString() },
          { id: "a-1", role: "assistant", content: acc, created_at: new Date().toISOString() },
        ]);
        qc.invalidateQueries({ queryKey: ["chats"] });
        qc.invalidateQueries({ queryKey: ["messages", finalChatId] });
      }
      updateActiveStream({ done: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setActiveStream(null);
    } finally {
      setSending(false);
    }
  };




  const suggestions = [
    { title: "Solve homework from a photo", prompt: "Solve the math problem in this image step by step." },
    { title: "Explain a screenshot", prompt: "Explain what this screenshot is showing." },
    { title: "Translate to Manipuri", prompt: "Translate to Manipuri: The rain is falling softly today." },
    { title: "Explain in English", prompt: "Explain quantum computing like I'm 12." },
  ];

  return (
    <div className="flex h-full flex-col">

        <div className="flex-1 overflow-y-auto">
          <div className={`mx-auto ${pendingHere ? "" : "flex min-h-full justify-center"} max-w-2xl flex-col px-4 py-10`}>
            {!pendingHere && (
              <>
                <div className="text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground text-2xl leading-none font-semibold shadow-glow" aria-hidden="true">
                    ꯃ
                  </div>
                  <h1 className="mt-5 font-display text-3xl font-bold">How can I help you today?</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Write in Manipuri or English — attach photos of homework, math, docs, or screenshots and I'll answer based on them.
                  </p>
                </div>

                <div className="mt-8 grid gap-2 sm:grid-cols-2">
                  {suggestions.map((s) => (
                    <button
                      key={s.title}
                      onClick={() => { setInput(s.prompt); inputRef.current?.focus(); }}
                      className="rounded-xl border border-border bg-card p-3 text-left text-sm shadow-soft transition-colors hover:border-primary/40 hover:bg-accent/20"
                    >
                      <div className="font-medium">{s.title}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{s.prompt}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {pendingHere && (
              <div className="animate-fade-in">
                <div className="my-6 flex flex-row-reverse items-start gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground text-xs font-semibold">You</div>
                  <div className="inline-block max-w-[85%] rounded-2xl rounded-tr-md bg-secondary px-4 py-2.5 text-secondary-foreground">
                    <p className="whitespace-pre-wrap text-sm">{pendingHere.userText.replace(/!\[[^\]]*\]\([^)]+\)\n?/g, "").trim() || "(image)"}</p>
                  </div>
                </div>
                <div className="my-6 flex items-start gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground text-base leading-none font-semibold" aria-hidden="true">ꯃ</div>
                  <div className="min-w-0 flex-1">
                    {pendingHere.generatingImage ? (
                      <ImageGeneratingAnimation />
                    ) : pendingHere.streaming ? (
                      <StreamingAssistantContent content={pendingHere.streaming} />
                    ) : (
                      <div className="flex items-center gap-1 pt-3">
                        <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                        <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0.15s" }} />
                        <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0.3s" }} />
                      </div>
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


