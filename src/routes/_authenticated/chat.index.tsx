import { createFileRoute, useNavigate } from "@tanstack/react-router";
// re-export usage in Composer
import { useState, useRef, useEffect } from "react";
import { AuthedShell } from "@/components/AuthedShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Loader2, Zap, Brain, ImagePlus, X, AudioLines, Sparkles } from "lucide-react";
import { streamChat } from "@/lib/chat-stream";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chat/")({
  head: () => ({ meta: [{ title: "New chat — Manipuri AI" }] }),
  component: NewChat,
});

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB per image

export async function readImagesAsDataUrls(files: FileList | File[]): Promise<string[]> {
  const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
  const out: string[] = [];
  for (const f of arr) {
    if (f.size > MAX_IMAGE_BYTES) {
      toast.error(`${f.name} is too large (max 6 MB)`);
      continue;
    }
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    out.push(url);
  }
  return out;
}

function NewChat() {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [lang, setLang] = useState<"auto" | "mni" | "mni-mtei" | "en">("auto");
  const [mode, setMode] = useState<"instant" | "think">("instant");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<{ text: string; images: string[] } | null>(null);
  const [streaming, setStreaming] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [pending, streaming]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if ((!text && images.length === 0) || sending) return;
    setSending(true);
    const sentImages = images;
    const imgTags = sentImages.map((u) => `![image](${u})`).join("\n");
    const stored = text ? (imgTags ? `${imgTags}\n\n${text}` : text) : imgTags;
    // Instantly reflect the message in the UI and clear the composer.
    setInput("");
    setImages([]);
    setPending({ text: stored, images: sentImages });
    setStreaming("");
    try {
      let newChatId: string | null = null;
      let acc = "";
      await streamChat({
        chatId: null,
        message: text,
        images: sentImages,
        language: lang,
        mode,
        onMeta: (m) => {
          newChatId = m.chatId;
        },
        onChunk: (delta) => {
          acc += delta;
          setStreaming(acc);
        },
      });
      if (newChatId) {
        // Seed cache so the destination route renders instantly without refetch flicker.
        qc.setQueryData(["messages", newChatId], [
          { id: "u-1", role: "user", content: stored, created_at: new Date().toISOString() },
          { id: "a-1", role: "assistant", content: acc, created_at: new Date().toISOString() },
        ]);
        qc.invalidateQueries({ queryKey: ["chats"] });
        navigate({ to: "/chat/$chatId", params: { chatId: newChatId } });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setPending(null);
      setStreaming("");
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
    <AuthedShell>
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className={`mx-auto ${pending ? "" : "flex min-h-full justify-center"} max-w-2xl flex-col px-4 py-10`}>
            {!pending && (
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

            {pending && (
              <div className="animate-fade-in">
                <div className="my-6 flex flex-row-reverse items-start gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground text-xs font-semibold">You</div>
                  <div className="inline-block max-w-[85%] rounded-2xl rounded-tr-md bg-secondary px-4 py-2.5 text-secondary-foreground">
                    <p className="whitespace-pre-wrap text-sm">{pending.text.replace(/!\[[^\]]*\]\([^)]+\)\n?/g, "").trim() || "(image)"}</p>
                  </div>
                </div>
                <div className="my-6 flex items-start gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground text-base leading-none font-semibold" aria-hidden="true">ꯃ</div>
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
    </AuthedShell>
  );
}

export function Composer({
  input, setInput, images, setImages, onSubmit, sending, inputRef, lang, setLang, mode, setMode,
}: {
  input: string;
  setInput: (v: string) => void;
  images: string[];
  setImages: (v: string[]) => void;
  onSubmit: (e: React.FormEvent) => void;
  sending: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  lang: "auto" | "mni" | "mni-mtei" | "en";
  setLang: (v: "auto" | "mni" | "mni-mtei" | "en") => void;
  mode: "instant" | "think";
  setMode: (v: "instant" | "think") => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      toast.error(`You can attach up to ${MAX_IMAGES} images`);
      return;
    }
    const picked = Array.from(files).slice(0, remaining);
    try {
      const urls = await readImagesAsDataUrls(picked);
      if (urls.length) setImages([...images, ...urls]);
    } catch {
      toast.error("Failed to read image");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = (i: number) => {
    setImages(images.filter((_, idx) => idx !== i));
  };

  const canSubmit = (input.trim().length > 0 || images.length > 0) && !sending;

  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-white">
      <form onSubmit={onSubmit} className="mx-auto max-w-2xl px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="rounded-2xl border border-neutral-300 bg-white p-2 shadow-soft focus-within:ring-2 focus-within:ring-neutral-400">
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1">
              {images.map((src, i) => (
                <div key={i} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-neutral-300 bg-neutral-100">
                  <img src={src} alt={`attachment ${i + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label="Remove image"
                    className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-black text-white shadow"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData?.items ?? []);
              const files = items.map((it) => it.getAsFile()).filter((f): f is File => !!f && f.type.startsWith("image/"));
              if (files.length) {
                e.preventDefault();
                void onPickFiles(files as unknown as FileList);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(e as unknown as React.FormEvent); }
            }}
            rows={1}
            placeholder={images.length ? "Ask about the image…" : "Message Manipuri AI…"}
            style={{ fontSize: "16px" }}
            className="min-h-11 resize-none border-0 bg-white text-black placeholder:text-neutral-500 px-2 py-2 focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onPickFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileRef.current?.click()}
                disabled={sending || images.length >= MAX_IMAGES}
                aria-label="Attach image"
                title="Attach image (homework, docs, math, screenshots)"
                className="h-8 w-8 shrink-0 rounded-full text-black hover:bg-neutral-100"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
              <Select value={mode} onValueChange={(v) => setMode(v as "instant" | "think")}>
                <SelectTrigger className="h-8 w-auto shrink-0 gap-1.5 border-0 bg-transparent px-2 text-xs font-medium text-black hover:bg-neutral-100 [&>svg:last-child]:hidden">
                  {mode === "instant" ? <Zap className="h-3.5 w-3.5 text-black" /> : <Brain className="h-3.5 w-3.5 text-black" />}
                  <span>{mode === "instant" ? "Instant" : "Think"}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instant">
                    <div className="flex flex-col">
                      <span className="font-medium">Instant reply</span>
                      <span className="text-[11px] text-muted-foreground">Fast responses for everyday chat</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="think">
                    <div className="flex flex-col">
                      <span className="font-medium">Deep thinking</span>
                      <span className="text-[11px] text-muted-foreground">Slower, better for research & reasoning</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select value={lang} onValueChange={(v) => setLang(v as "auto" | "mni" | "mni-mtei" | "en")}>
                <SelectTrigger className="h-8 w-auto shrink-0 gap-1.5 border-0 bg-transparent px-2 text-xs font-medium text-black hover:bg-neutral-100 [&>svg:last-child]:hidden">
                  <span className="max-w-[90px] truncate">
                    {lang === "auto" ? "Auto" : lang === "mni" ? "Manipuri" : lang === "mni-mtei" ? "Mayek ꯃ" : "English"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect language</SelectItem>
                  <SelectItem value="mni">Reply in Manipuri (Latin)</SelectItem>
                  <SelectItem value="mni-mtei">Reply in Manipuri (Meitei Mayek ꯃꯌꯦꯛ)</SelectItem>
                  <SelectItem value="en">Reply in English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => navigate({ to: "/image" })}
              aria-label="Create image"
              title="Create image with AI"
              className="h-10 w-10 shrink-0 rounded-full text-black hover:bg-neutral-100"
            >
              <Sparkles className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => navigate({ to: "/voice" })}
              aria-label="Voice mode"
              title="Voice mode"
              className="h-10 w-10 shrink-0 rounded-full text-black hover:bg-neutral-100"
            >
              <AudioLines className="h-5 w-5" />
            </Button>
            <Button type="submit" size="icon" disabled={!canSubmit} className="h-10 w-10 shrink-0 rounded-full bg-black text-white hover:bg-neutral-800 transition-transform active:scale-90">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 send-fly-target" />}
            </Button>
          </div>
        </div>

        <p className="mt-2 text-center text-[10px] whitespace-pre-wrap text-muted-foreground">{"Manipuri AI can make mistakes. Verify important info. DEVELOPED BY LEONATH\n"}</p>
      </form>
    </div>
  );
}
