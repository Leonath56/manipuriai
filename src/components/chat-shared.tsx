import { useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUp, Square, Loader2, Zap, Brain, ImagePlus, X, AudioLines, Sparkles, Languages, Mic, Wand2 } from "lucide-react";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { ImageResultCard } from "@/components/ImageResultCard";
import { parseImageMessage } from "@/lib/image-gen";
import { LANG_TOOLS, LANG_TOOL_GROUPS, type LangTool } from "@/lib/lang-tools";
import { mayekLeading } from "@/lib/script";
import { MAX_IMAGE_BYTES } from "@/lib/image-input";
import { useDictation } from "@/lib/use-dictation";
import { toast } from "sonner";

const MAX_IMAGES = 4;

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

export { ThinkingLoader } from "./ThinkingLoader";

export function StreamingAssistantContent({ content }: { content: string }) {
  const imageMeta = parseImageMessage(content);
  if (imageMeta) {
    return <ImageResultCard prompt={imageMeta.prompt} images={imageMeta.images} />;
  }
  return <ChatMarkdown content={content} />;
}

export function Composer({
  input, setInput, images, setImages, onSubmit, sending, inputRef, lang, setLang, mode, setMode,
  onStop,
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
  /** Cancels the in-flight reply. When provided, Send becomes Stop mid-stream. */
  onStop?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  /*
   * Auto-grow. The textarea was `rows={1}` with a fixed `min-h-11` and
   * `resize-none`, so anything longer than one line became a one-line scrolling
   * slit — you could not see what you had typed. It now grows to MAX_ROWS_PX and
   * scrolls after that.
   */
  const MAX_H = 208; // ~8 rows at 15px/1.6
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_H);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_H ? "auto" : "hidden";
  }, [input, inputRef]);

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

  /*
   * Drag & drop. Pasting an image already worked; dragging one from the desktop
   * dropped it onto the browser and navigated away from the conversation.
   */
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const onDragEnter = (e: React.DragEvent) => {
    if (sending || !isFileDrag(e)) return;
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    // Counted, not toggled: dragging across a child element fires leave on the
    // parent, which would flicker the highlight off mid-drag.
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (sending) return;
    void onPickFiles(e.dataTransfer.files);
  };

  /*
   * Dictation. Meiteilon has no comfortable keyboard in either script, so
   * speaking is often the fastest way in. Transcription lands in the draft for
   * review rather than sending itself — a misheard word should be fixable.
   */
  const dictation = useDictation({
    language: lang,
    onText: (text) => {
      const el = inputRef.current;
      const next = input.trim() ? `${input.replace(/\s+$/, "")} ${text}` : text;
      setInput(next);
      el?.focus();
    },
    onError: (msg) => toast.error(msg),
  });
  const recording = dictation.state === "recording";
  const transcribing = dictation.state === "transcribing";

  /*
   * Language tools. Each one rewrites the draft into the precise request that
   * gets sent, so the user can read and edit it first — and so the saved message
   * matches what the model was actually asked.
   */
  const lastToolRef = useRef<{ built: string; source: string } | null>(null);
  const applyTool = (tool: LangTool) => {
    // Re-applying a tool works from the original text instead of nesting one
    // instruction inside another.
    const base =
      lastToolRef.current && lastToolRef.current.built === input ? lastToolRef.current.source : input;
    const source = base.trim();
    if (!source) return;
    const built = tool.build(source);
    lastToolRef.current = { built, source };
    setInput(built);
    if (tool.lang) setLang(tool.lang);
    const el = inputRef.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = el.value.length;
      });
    }
  };

  const hasContent = input.trim().length > 0 || images.length > 0;
  const canSubmit = hasContent && !sending;
  const showStop = sending && Boolean(onStop);

  /*
   * Esc stops the reply that's generating — the same key that backs out of
   * everything else here, and the one people try before hunting for the button.
   *
   * Bound on the window rather than the textarea so it works while the user has
   * scrolled up to read, and held in a ref so the listener isn't torn down and
   * rebuilt on every keystroke (the parent routes pass a fresh `stop` closure
   * each render). Skipped when another layer already owns the key: an open
   * dropdown, select or dialog should close itself, not cancel the generation
   * behind it.
   */
  const stopRef = useRef(onStop);
  stopRef.current = onStop;
  useEffect(() => {
    if (!sending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const layerOpen = document.querySelector(
        '[data-state="open"][role="dialog"],[data-state="open"][role="menu"],[data-state="open"][role="listbox"]',
      );
      if (layerOpen) return;
      stopRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sending]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    /*
     * Never send mid-composition. Meitei Mayek and Manipuri input methods use
     * Enter to commit a candidate, so the old unconditional handler fired the
     * message off while the word was still being composed — it would send a
     * half-typed word and swallow the rest. `isComposing` is the standard guard.
     */
    if ((e.nativeEvent as KeyboardEvent).isComposing) return;
    /*
     * On touch keyboards Enter is the newline key people reach for, and there is
     * a visible Send button right there — sending on Enter is the classic
     * accidental-submit bug. Desktop keeps Enter-to-send.
     */
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) return;
    if (!canSubmit) {
      e.preventDefault(); // swallow the newline rather than submitting nothing
      return;
    }
    e.preventDefault();
    onSubmit(e as unknown as React.FormEvent);
  };

  // Shared styling for the two pill selects so they cannot drift apart.
  const pillTrigger =
    "h-9 w-auto shrink-0 gap-1.5 rounded-full border border-border bg-muted/60 px-3 text-xs " +
    "font-medium text-foreground hover:bg-accent !animate-none !transition-none " +
    "button-click-feedback [&>svg:last-child]:hidden";

  return (
    <div className="sticky bottom-0 z-20 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <form
        onSubmit={onSubmit}
        className="mx-auto max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pb-4"
      >
        {/*
          One surface for the whole composer. The input used to be a white card
          on a pure-black bar, with its toolbar sitting outside the card on the
          bar itself — two unrelated colour worlds stacked on each other, and the
          only light-on-dark inversion in the app.
        */}
        <div
          onDragEnter={onDragEnter}
          onDragOver={(e) => {
            if (isFileDrag(e)) e.preventDefault();
          }}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`relative rounded-2xl border bg-card shadow-raise transition-colors focus-within:border-gold/45 ${
            dragging ? "border-gold/70 bg-accent/40" : "border-border"
          }`}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-card/85 text-sm font-medium">
              <span className="flex items-center gap-2">
                <ImagePlus className="h-4 w-4 text-gold" />
                Drop to attach
              </span>
            </div>
          )}
          {images.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-3 pt-3">
              {images.map((src, i) => (
                <li
                  key={i}
                  className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-muted"
                >
                  <img
                    src={src}
                    alt={`Attachment ${i + 1}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label={`Remove attachment ${i + 1}`}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-background/85 text-foreground opacity-100 shadow-sm backdrop-blur hover:bg-destructive hover:text-destructive-foreground md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
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
            onKeyDown={onKeyDown}
            rows={1}
            aria-label="Message Manipuri AI"
            placeholder={
              recording
                ? "Listening… press the mic again when you're done"
                : transcribing
                  ? "Writing down what you said…"
                  : images.length
                    ? "Ask about the image…"
                    : "Message Manipuri AI…"
            }
            // 16px keeps iOS Safari from zooming the viewport on focus.
            style={{ fontSize: "16px" }}
            // Meetei Mayek needs its own family and leading — see lib/script.ts.
            className={`max-h-52 min-h-11 resize-none border-0 bg-transparent px-4 py-3 shadow-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-[15px] ${mayekLeading(input)}`}
          />

          {/*
            Toolbar. The scrolling region is the left group only — Send and Stop
            live outside it. Previously the whole row was `overflow-x-auto` with
            Send inside, so on a narrow phone the send button scrolled off the
            edge of its own composer.
          */}
          <div className="flex items-center gap-2 px-2 pb-2">
            <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
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
                aria-label={images.length >= MAX_IMAGES ? `Attachment limit reached (${MAX_IMAGES})` : "Attach a photo"}
                title="Attach a photo"
                className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ImagePlus className="h-[18px] w-[18px]" />
              </Button>

              {/*
                Dictate into the composer. Distinct from the waveform button
                below, which opens the hands-free /voice conversation: this one
                puts editable text in the box and stays in the thread.
              */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => (recording ? dictation.stop() : dictation.start())}
                disabled={sending || transcribing}
                aria-label={recording ? "Stop dictating" : "Dictate a message"}
                aria-pressed={recording}
                title={recording ? "Stop dictating" : "Dictate a message"}
                className={`h-9 w-9 shrink-0 rounded-full ${
                  recording
                    ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {transcribing ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" />
                ) : recording ? (
                  <Square className="h-[15px] w-[15px] fill-current" />
                ) : (
                  <Mic className="h-[18px] w-[18px]" />
                )}
              </Button>




              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => navigate({ to: "/image" })}
                aria-label="Create an image"
                title="Create an image"
                className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Sparkles className="h-[18px] w-[18px]" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => navigate({ to: "/voice" })}
                disabled={sending}
                aria-label="Talk to Manipuri AI"
                title="Talk to Manipuri AI"
                className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <AudioLines className="h-[18px] w-[18px]" />
              </Button>

              <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />

              <Select value={mode} onValueChange={(v) => setMode(v as "instant" | "think")}>
                <SelectTrigger aria-label="Reply speed" title="Reply speed" className={pillTrigger}>
                  {mode === "instant" ? <Zap className="h-3.5 w-3.5" /> : <Brain className="h-3.5 w-3.5" />}
                  <span>{mode === "instant" ? "Instant" : "Think"}</span>
                </SelectTrigger>
                <SelectContent className="!animate-none !transition-none" position="popper" sideOffset={8}>
                  <SelectItem value="instant">
                    <div className="flex items-start gap-2.5">
                      <Zap className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                      <div className="flex flex-col">
                        <span className="font-medium">Instant reply</span>
                        <span className="text-[11px] text-muted-foreground">Fast answers for everyday chat</span>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="think">
                    <div className="flex items-start gap-2.5">
                      <Brain className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                      <div className="flex flex-col">
                        <span className="font-medium">Deep thinking</span>
                        <span className="text-[11px] text-muted-foreground">Slower, searches the web, better reasoning</span>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={lang} onValueChange={(v) => setLang(v as "auto" | "mni" | "mni-mtei" | "en")}>
                <SelectTrigger aria-label="Reply language" title="Reply language" className={pillTrigger}>
                  <Languages className="h-3.5 w-3.5" />
                  <span className="max-w-[92px] truncate">
                    {lang === "auto" ? "Auto" : lang === "mni" ? "Manipuri" : lang === "mni-mtei" ? "Mayek" : "English"}
                  </span>
                </SelectTrigger>
                <SelectContent className="!animate-none !transition-none" position="popper" sideOffset={8}>
                  <SelectItem value="auto">Match my language</SelectItem>
                  <SelectItem value="mni">Reply in Manipuri (Latin)</SelectItem>
                  <SelectItem value="mni-mtei">
                    Reply in <span className="font-mayek">ꯃꯤꯇꯩ ꯃꯌꯦꯛ</span>
                  </SelectItem>
                  <SelectItem value="en">Reply in English</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showStop ? (
              <Button
                type="button"
                onClick={onStop}
                size="icon"
                aria-label="Stop generating"
                title="Stop generating"
                className="h-10 w-10 shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/90"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!canSubmit}
                size="icon"
                aria-label="Send message"
                title="Send message"
                className="h-10 w-10 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[18px] w-[18px]" />}
              </Button>
            )}
          </div>
        </div>

        <p className="mt-2 px-1 text-center text-[11px] leading-tight text-muted-foreground">
          Manipuri AI can make mistakes — check important details.
        </p>
      </form>
    </div>
  );
}
