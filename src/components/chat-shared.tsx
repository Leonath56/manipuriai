import { useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Loader2, Zap, Brain, ImagePlus, X, AudioLines, Sparkles } from "lucide-react";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { ImageResultCard } from "@/components/ImageResultCard";
import { parseImageMessage } from "@/lib/image-gen";
import { toast } from "sonner";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

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

export function ImageGeneratingAnimation() {
  const stages = [
    { key: "queued", label: "Queued", target: 15 },
    { key: "generating", label: "Generating", target: 65 },
    { key: "rendering", label: "Rendering", target: 95 },
  ] as const;
  const [stageIdx, setStageIdx] = useState(0);
  const [progress, setProgress] = useState(4);

  useEffect(() => {
    const t1 = setTimeout(() => setStageIdx(1), 1200);
    const t2 = setTimeout(() => setStageIdx(2), 6500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    const target = stages[stageIdx].target;
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= target) return p;
        const step = Math.max(0.3, (target - p) * 0.08);
        return Math.min(target, p + step);
      });
    }, 120);
    return () => clearInterval(id);
  }, [stageIdx]);

  return (
    <div className="pt-1.5">
      <div className="image-gen-stage relative w-full max-w-[300px] overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-xl border border-border/60 bg-background/40">
          <div className="image-gen-scan absolute inset-x-0 top-0 h-16" />
          <div className="image-gen-grid absolute inset-0 opacity-70" />
          <div className="relative grid h-16 w-16 place-items-center rounded-full border border-border bg-background/80 text-3xl font-semibold leading-none shadow-glow" aria-hidden="true">
            ꯃ
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">{stages[stageIdx].label}…</span>
            <span className="tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <ul className="mt-2 space-y-1 text-[11px]">
            {stages.map((s, i) => {
              const done = i < stageIdx;
              const active = i === stageIdx;
              return (
                <li key={s.key} className="flex items-center gap-2">
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] ${
                      done
                        ? "border-primary bg-primary text-primary-foreground"
                        : active
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                    aria-hidden="true"
                  >
                    {done ? "✓" : active ? <span className="image-gen-pulse">●</span> : i + 1}
                  </span>
                  <span className={done || active ? "text-foreground" : "text-muted-foreground"}>
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function StreamingAssistantContent({ content }: { content: string }) {
  const imageMeta = parseImageMessage(content);
  if (imageMeta) {
    return <ImageResultCard prompt={imageMeta.prompt} images={imageMeta.images} />;
  }
  return <ChatMarkdown content={content} />;
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
