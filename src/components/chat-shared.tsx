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
                  <img src={src} alt={`attachment ${i + 1}`} loading="lazy" decoding="async" className="h-full w-full object-cover" />
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
          </div>
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
                  {mode === "instant" ? <span>⚡</span> : <span>🧠</span>}
                  <span>{mode === "instant" ? "Instant" : "Think"}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instant">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-base">⚡</span>
                      <div className="flex flex-col">
                        <span className="font-medium">Instant reply</span>
                        <span className="text-[11px] text-muted-foreground">Fast responses for everyday chat</span>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="think">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-base">🧠</span>
                      <div className="flex flex-col">
                        <span className="font-medium">Deep thinking</span>
                        <span className="text-[11px] text-muted-foreground">Slower, better for research & reasoning</span>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select value={lang} onValueChange={(v) => setLang(v as "auto" | "mni" | "mni-mtei" | "en")}>
                <SelectTrigger aria-label={"'''Do not make any visual modifications. The phrases I write are commands to understand what I want, not to be written down. Understand their content well, then execute what is required.'''\n                                            \n                                            Also improve the AI response rendering so Manipuriai.online has a clean, modern ChatGPT-like response appearance and feels visually distinct from a basic chatbot.\n\nIMPORTANT:\nDo NOT copy ChatGPT's branding, logo, exact UI, colors, or proprietary design. I want the same level of clean conversational response formatting and streaming behavior, while keeping Manipuriai's own identity and design.\n\n1. DO NOT RENDER THE ENTIRE RESPONSE AS ONE GIANT PARAGRAPH\n\nCurrently, the generated response can visually appear like one continuous block of text.\n\nInstead, render the AI response using proper Markdown-style formatting.\n\nThe response should naturally support:\n\nNormal paragraphs\n\nLine breaks between paragraphs\n\nHeadings\n\nBold text\n\nItalic text\n\nNumbered lists\n\nBullet lists\n\nNested lists\n\nBlockquotes\n\nInline code\n\nCode blocks with syntax highlighting\n\nTables when appropriate\n\nMathematical expressions when supported\n\nExample:\n\nInstead of displaying:\n\n\"Injection molding is a manufacturing process where molten plastic is injected into a mold. The material is then cooled and ejected. The process is widely used because it is fast and produces complex shapes.\"\n\nRender it naturally as:\n\n\"Injection molding is a manufacturing process where molten plastic is injected into a mold.\n\nThe material is then cooled and ejected from the mold.\n\nWhy is it used?\n\nHigh production speed\n\nExcellent repeatability\n\nComplex shapes can be produced\n\nSuitable for mass production\"\n\nDo NOT artificially add a line break after every sentence. Preserve natural paragraph structure.\n\n2. STREAMING MUST LOOK NATURAL\n\nWhen the AI generates text token-by-token:\n\nRender the response progressively as Markdown.\n\nDo not display raw Markdown syntax while streaming if it can be avoided.\n\nDo not constantly recreate the entire DOM unnecessarily.\n\nAvoid visual flickering.\n\nAvoid layout jumps.\n\nKeep the typography stable while the response grows.\n\nThe user should see the response naturally appearing as it is generated, similar to a modern AI chat interface.\n\n3. PROPER PARAGRAPH SPACING\n\nUse comfortable spacing between paragraphs.\n\nFor example:\n\nParagraph 1.\n\nParagraph 2.\n\nHeading\n\nParagraph.\n\nDo not make every line a separate paragraph.\n\nDo not use excessive vertical spacing.\n\nDo not make the response look like a plain <pre> block.\n\n4. MARKDOWN RENDERING\n\nInspect the existing response renderer.\n\nIf Markdown rendering already exists, improve it instead of replacing it unnecessarily.\n\nIf Markdown rendering is missing or incomplete, implement a proper Markdown renderer compatible with the existing React/TypeScript architecture.\n\nEnsure streamed Markdown does not break the layout.\n\nFor example:\n\nBold text\n\nItalic text\n\nItem one\n\nItem two\n\nItem three\n\nFirst\n\nSecond\n\nThird\n\nprint(\"Hello\")\n\n\nshould be rendered visually rather than displayed as raw Markdown whenever possible.\n\n5. CODE BLOCKS\n\nCode blocks should have:\n\nProper monospace font\n\nScrollable horizontal overflow\n\nSyntax highlighting where supported\n\nCopy button\n\nClean spacing\n\nNo page-wide horizontal overflow\n\nDo not allow long code lines to expand the entire webpage.\n\n6. TABLES\n\nWhen the AI produces a Markdown table, render it as an actual responsive table.\n\nOn small screens, allow horizontal scrolling inside the table instead of causing the entire webpage to scroll horizontally.\n\n7. RESPONSE WIDTH\n\nMake AI responses readable with a comfortable maximum width.\n\nDo not stretch extremely long paragraphs across the entire screen.\n\nUse proper line-height and typography.\n\nThe AI message should look like a polished conversational response rather than a raw text dump.\n\n8. AI RESPONSE VS USER MESSAGE\n\nMake the AI response visually distinct from the user's message.\n\nThe AI response should NOT need a large colored chat bubble.\n\nUse a clean conversational layout where:\n\nUser messages are clearly identifiable.\n\nAI responses have their own visual identity.\n\nAI content has more natural document-like formatting.\n\nThe layout remains minimal and modern.\n\nKeep Manipuriai's own branding and design language.\n\n9. STREAMING + SCROLLING MUST WORK TOGETHER\n\nCombine this with the previous scrolling requirement.\n\nDuring streaming:\n\nIF user is at the bottom:\n→ follow the newly generated response smoothly.\n\nIF user scrolls upward:\n→ immediately stop automatic scrolling.\n\nIF user is reading an older message:\n→ NEVER force the page downward.\n\nIF new content is generated while user is away from bottom:\n→ show the \"↓ New response\" / \"Jump to latest\" button.\n\nIF user clicks the button:\n→ smoothly move to the latest response.\n\nDo not use window.scrollTo() or scrollIntoView() on every generated token.\n\n10. IMPORTANT: DO NOT BREAK THE EXISTING AI STREAMING\n\nDo not change the backend/API/model implementation unless necessary.\n\nKeep the existing:\n\nAI model\n\nstreaming implementation\n\nconversation history\n\nchat persistence\n\nauthentication\n\nlanguage selection\n\nManipuri/English functionality\n\nweb search functionality\n\nimage generation functionality\n\nOnly improve the frontend response rendering and scrolling behavior.\n\n11. MAKE MANIPURIAI LOOK DISTINCT\n\nThe final result should feel like a professional AI assistant rather than a generic chatbot.\n\nUse:\n\nClean typography\n\nProper paragraph hierarchy\n\nSubtle spacing\n\nSmooth streaming\n\nWell-designed Markdown\n\nBeautiful code blocks\n\nClean lists\n\nResponsive tables\n\nMinimal AI message styling\n\nSmooth scrolling\n\nStable layout\n\nGood mobile behavior\n\nDo NOT copy ChatGPT's exact visual design.\n\nThe goal is:\n\n\"ChatGPT-quality conversation behavior + Manipuriai's own visual identity.\"\n\n12. TEST BEFORE FINISHING\n\nAfter implementing:\n\nSend a short question.\n\nSend a long question producing multiple paragraphs.\n\nSend a response containing headings and bullet points.\n\nSend a response containing code.\n\nStart generating a long response.\n\nWhile it is generating, manually scroll upward.\n\nVerify the page DOES NOT pull the user back down.\n\nScroll back to the bottom.\n\nVerify streaming automatically follows again.\n\nTest the \"↓ New response\" button.\n\nTest on mobile-sized viewport.\n\nVerify there is no horizontal page scrolling.\n\nVerify the response does not appear as one giant paragraph.\n\nFix any remaining layout shifts, scroll jumps, or streaming flickering before considering the task complete."} title={"'''Do not make any visual modifications. The phrases I write are commands to understand what I want, not to be written down. Understand their content well, then execute what is required.'''\n                                            \n                                            Also improve the AI response rendering so Manipuriai.online has a clean, modern ChatGPT-like response appearance and feels visually distinct from a basic chatbot.\n\nIMPORTANT:\nDo NOT copy ChatGPT's branding, logo, exact UI, colors, or proprietary design. I want the same level of clean conversational response formatting and streaming behavior, while keeping Manipuriai's own identity and design.\n\n1. DO NOT RENDER THE ENTIRE RESPONSE AS ONE GIANT PARAGRAPH\n\nCurrently, the generated response can visually appear like one continuous block of text.\n\nInstead, render the AI response using proper Markdown-style formatting.\n\nThe response should naturally support:\n\nNormal paragraphs\n\nLine breaks between paragraphs\n\nHeadings\n\nBold text\n\nItalic text\n\nNumbered lists\n\nBullet lists\n\nNested lists\n\nBlockquotes\n\nInline code\n\nCode blocks with syntax highlighting\n\nTables when appropriate\n\nMathematical expressions when supported\n\nExample:\n\nInstead of displaying:\n\n\"Injection molding is a manufacturing process where molten plastic is injected into a mold. The material is then cooled and ejected. The process is widely used because it is fast and produces complex shapes.\"\n\nRender it naturally as:\n\n\"Injection molding is a manufacturing process where molten plastic is injected into a mold.\n\nThe material is then cooled and ejected from the mold.\n\nWhy is it used?\n\nHigh production speed\n\nExcellent repeatability\n\nComplex shapes can be produced\n\nSuitable for mass production\"\n\nDo NOT artificially add a line break after every sentence. Preserve natural paragraph structure.\n\n2. STREAMING MUST LOOK NATURAL\n\nWhen the AI generates text token-by-token:\n\nRender the response progressively as Markdown.\n\nDo not display raw Markdown syntax while streaming if it can be avoided.\n\nDo not constantly recreate the entire DOM unnecessarily.\n\nAvoid visual flickering.\n\nAvoid layout jumps.\n\nKeep the typography stable while the response grows.\n\nThe user should see the response naturally appearing as it is generated, similar to a modern AI chat interface.\n\n3. PROPER PARAGRAPH SPACING\n\nUse comfortable spacing between paragraphs.\n\nFor example:\n\nParagraph 1.\n\nParagraph 2.\n\nHeading\n\nParagraph.\n\nDo not make every line a separate paragraph.\n\nDo not use excessive vertical spacing.\n\nDo not make the response look like a plain <pre> block.\n\n4. MARKDOWN RENDERING\n\nInspect the existing response renderer.\n\nIf Markdown rendering already exists, improve it instead of replacing it unnecessarily.\n\nIf Markdown rendering is missing or incomplete, implement a proper Markdown renderer compatible with the existing React/TypeScript architecture.\n\nEnsure streamed Markdown does not break the layout.\n\nFor example:\n\nBold text\n\nItalic text\n\nItem one\n\nItem two\n\nItem three\n\nFirst\n\nSecond\n\nThird\n\nprint(\"Hello\")\n\n\nshould be rendered visually rather than displayed as raw Markdown whenever possible.\n\n5. CODE BLOCKS\n\nCode blocks should have:\n\nProper monospace font\n\nScrollable horizontal overflow\n\nSyntax highlighting where supported\n\nCopy button\n\nClean spacing\n\nNo page-wide horizontal overflow\n\nDo not allow long code lines to expand the entire webpage.\n\n6. TABLES\n\nWhen the AI produces a Markdown table, render it as an actual responsive table.\n\nOn small screens, allow horizontal scrolling inside the table instead of causing the entire webpage to scroll horizontally.\n\n7. RESPONSE WIDTH\n\nMake AI responses readable with a comfortable maximum width.\n\nDo not stretch extremely long paragraphs across the entire screen.\n\nUse proper line-height and typography.\n\nThe AI message should look like a polished conversational response rather than a raw text dump.\n\n8. AI RESPONSE VS USER MESSAGE\n\nMake the AI response visually distinct from the user's message.\n\nThe AI response should NOT need a large colored chat bubble.\n\nUse a clean conversational layout where:\n\nUser messages are clearly identifiable.\n\nAI responses have their own visual identity.\n\nAI content has more natural document-like formatting.\n\nThe layout remains minimal and modern.\n\nKeep Manipuriai's own branding and design language.\n\n9. STREAMING + SCROLLING MUST WORK TOGETHER\n\nCombine this with the previous scrolling requirement.\n\nDuring streaming:\n\nIF user is at the bottom:\n→ follow the newly generated response smoothly.\n\nIF user scrolls upward:\n→ immediately stop automatic scrolling.\n\nIF user is reading an older message:\n→ NEVER force the page downward.\n\nIF new content is generated while user is away from bottom:\n→ show the \"↓ New response\" / \"Jump to latest\" button.\n\nIF user clicks the button:\n→ smoothly move to the latest response.\n\nDo not use window.scrollTo() or scrollIntoView() on every generated token.\n\n10. IMPORTANT: DO NOT BREAK THE EXISTING AI STREAMING\n\nDo not change the backend/API/model implementation unless necessary.\n\nKeep the existing:\n\nAI model\n\nstreaming implementation\n\nconversation history\n\nchat persistence\n\nauthentication\n\nlanguage selection\n\nManipuri/English functionality\n\nweb search functionality\n\nimage generation functionality\n\nOnly improve the frontend response rendering and scrolling behavior.\n\n11. MAKE MANIPURIAI LOOK DISTINCT\n\nThe final result should feel like a professional AI assistant rather than a generic chatbot.\n\nUse:\n\nClean typography\n\nProper paragraph hierarchy\n\nSubtle spacing\n\nSmooth streaming\n\nWell-designed Markdown\n\nBeautiful code blocks\n\nClean lists\n\nResponsive tables\n\nMinimal AI message styling\n\nSmooth scrolling\n\nStable layout\n\nGood mobile behavior\n\nDo NOT copy ChatGPT's exact visual design.\n\nThe goal is:\n\n\"ChatGPT-quality conversation behavior + Manipuriai's own visual identity.\"\n\n12. TEST BEFORE FINISHING\n\nAfter implementing:\n\nSend a short question.\n\nSend a long question producing multiple paragraphs.\n\nSend a response containing headings and bullet points.\n\nSend a response containing code.\n\nStart generating a long response.\n\nWhile it is generating, manually scroll upward.\n\nVerify the page DOES NOT pull the user back down.\n\nScroll back to the bottom.\n\nVerify streaming automatically follows again.\n\nTest the \"↓ New response\" button.\n\nTest on mobile-sized viewport.\n\nVerify there is no horizontal page scrolling.\n\nVerify the response does not appear as one giant paragraph.\n\nFix any remaining layout shifts, scroll jumps, or streaming flickering before considering the task complete."} className="h-8 w-auto shrink-0 gap-1.5 border-0 bg-transparent px-2 text-xs font-medium text-black hover:bg-neutral-100 [&>svg:last-child]:hidden">
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
            type="submit"
            disabled={!canSubmit}
            size="icon"
            variant="ghost"
            className={`h-10 w-10 shrink-0 rounded-full transition-all duration-300 ${
              canSubmit
                ? "bg-black text-white hover:bg-neutral-800 scale-100 opacity-100"
                : "bg-neutral-100 text-neutral-400 scale-95 opacity-50 cursor-not-allowed"
            }`}
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className={`h-5 w-5 ${canSubmit ? "send-fly" : ""}`} />}
          </Button>
        </div>
      </form>
    </div>
  );
}
