import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { AuthedShell } from "@/components/AuthedShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Loader2, ImageIcon, Sparkles, MessageSquare } from "lucide-react";
import { generateImages, type ImageGenParams } from "@/lib/image-gen";
import { ImageResultCard } from "@/components/ImageResultCard";
import { PaidFeatureGate } from "@/components/PaidFeatureGate";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/image")({
  head: () => ({ meta: [{ title: "Create image — Manipuri AI" }] }),
  component: ImagePage,
});

type Style = ImageGenParams["style"];

const STYLES: { value: Style; label: string }[] = [
  { value: "none", label: "None" },
  { value: "realistic", label: "Realistic" },
  { value: "anime", label: "Anime" },
  { value: "digital-art", label: "Digital Art" },
  { value: "oil-painting", label: "Oil Painting" },
  { value: "3d-render", label: "3D Render" },
  { value: "pixel-art", label: "Pixel Art" },
  { value: "watercolor", label: "Watercolor" },
];

const SUGGESTIONS = [
  "A futuristic city at sunset with flying cars",
  "A realistic Bengal tiger in a misty forest",
  "Anime girl with blue hair, cherry blossom background",
  "Traditional Manipuri Ras Leela dancer, cinematic lighting",
];

function ImagePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "16:9" | "9:16">("1:1");
  const [quality, setQuality] = useState<"standard" | "hd">("standard");
  const [count, setCount] = useState(1);
  const [style, setStyle] = useState<Style>("none");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ prompt: string; images: string[]; chatId: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await generateImages({
        chatId: null,
        prompt: text,
        aspectRatio,
        quality,
        count,
        style,
      });
      setResult({ prompt: text, images: res.images, chatId: res.chatId });
      qc.invalidateQueries({ queryKey: ["chats"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Image generation failed");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!result || busy) return;
    setBusy(true);
    try {
      const res = await generateImages({
        chatId: result.chatId,
        prompt: result.prompt,
        aspectRatio,
        quality,
        count,
        style,
      });
      setResult({ prompt: result.prompt, images: res.images, chatId: res.chatId });
      qc.invalidateQueries({ queryKey: ["chats"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthedShell>
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-8">
            {!result && !busy && (
              <div className="text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h1 className="mt-5 font-display text-3xl font-bold">Create an image</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Describe what you want. Manipuri AI will render it in seconds.
                </p>
                <div className="mt-8 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setPrompt(s); inputRef.current?.focus(); }}
                      className="rounded-xl border border-border bg-card p-3 text-left text-sm shadow-soft transition-colors hover:border-primary/40 hover:bg-accent/20"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {busy && (
              <div className="my-10 flex flex-col items-center gap-4">
                <div className="relative">
                  <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20 blur-2xl" />
                  <div className="relative grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Loader2 className="h-7 w-7 animate-spin" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="font-medium">Generating {count > 1 ? `${count} images` : "your image"}…</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {quality === "hd" ? "HD quality can take 20–40s" : "Usually 8–20s"}
                  </p>
                </div>
                <SkeletonGrid count={count} aspectRatio={aspectRatio} />
              </div>
            )}

            {result && !busy && (
              <div className="animate-fade-in">
                <div className="mb-3 flex flex-row-reverse items-start gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground text-xs font-semibold">You</div>
                  <div className="inline-block max-w-[85%] rounded-2xl rounded-tr-md bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
                    {result.prompt}
                  </div>
                </div>
                <div className="my-6 flex items-start gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground text-base leading-none font-semibold">ꯃ</div>
                  <div className="min-w-0 flex-1">
                    <ImageResultCard
                      prompt={result.prompt}
                      images={result.images}
                      onRegenerate={regenerate}
                      onCopyPrompt={() => setPrompt(result.prompt)}
                    />
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate({ to: "/chat/$chatId", params: { chatId: result.chatId } })}
                        className="gap-1.5"
                      >
                        <MessageSquare className="h-3.5 w-3.5" /> Open in chat
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-border bg-white">
          <form onSubmit={submit} className="mx-auto max-w-3xl px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="rounded-2xl border border-neutral-300 bg-white p-2 shadow-soft focus-within:ring-2 focus-within:ring-neutral-400">
              <Textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
                rows={1}
                placeholder="Describe the image you want to create…"
                style={{ fontSize: "16px" }}
                className="min-h-11 resize-none border-0 bg-white text-black placeholder:text-neutral-500 px-2 py-2 focus-visible:ring-0"
              />
              <div className="flex flex-wrap items-center gap-1 px-1 pt-1">
                <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as "1:1" | "16:9" | "9:16")}>
                  <SelectTrigger className="h-8 w-auto gap-1 border-0 bg-transparent px-2 text-xs font-medium text-black hover:bg-neutral-100">
                    <SelectValue placeholder="Aspect" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1:1">Square (1:1)</SelectItem>
                    <SelectItem value="16:9">Landscape (16:9)</SelectItem>
                    <SelectItem value="9:16">Portrait (9:16)</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={quality} onValueChange={(v) => setQuality(v as "standard" | "hd")}>
                  <SelectTrigger className="h-8 w-auto gap-1 border-0 bg-transparent px-2 text-xs font-medium text-black hover:bg-neutral-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="hd">HD</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
                  <SelectTrigger className="h-8 w-auto gap-1 border-0 bg-transparent px-2 text-xs font-medium text-black hover:bg-neutral-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "image" : "images"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={style} onValueChange={(v) => setStyle(v as Style)}>
                  <SelectTrigger className="h-8 w-auto gap-1 border-0 bg-transparent px-2 text-xs font-medium text-black hover:bg-neutral-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STYLES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate({ to: "/chat" })}
                    aria-label="Back to chat"
                    title="Back to chat"
                    className="h-9 w-9 rounded-full text-black hover:bg-neutral-100"
                  >
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!prompt.trim() || busy}
                    className="h-10 w-10 rounded-full bg-black text-white hover:bg-neutral-800"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              <ImageIcon className="mr-1 inline h-3 w-3" />
              AI-generated images — for personal use. DEVELOPED BY LEONATH
            </p>
          </form>
        </div>
      </div>
    </AuthedShell>
  );
}

function SkeletonGrid({ count, aspectRatio }: { count: number; aspectRatio: "1:1" | "16:9" | "9:16" }) {
  const aspect = aspectRatio === "16:9" ? "aspect-video" : aspectRatio === "9:16" ? "aspect-[9/16]" : "aspect-square";
  const cols = count === 1 ? "grid-cols-1" : count === 2 ? "grid-cols-2" : "grid-cols-2";
  return (
    <div className={`mt-4 grid w-full max-w-xl gap-3 ${cols}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${aspect} animate-pulse rounded-xl bg-muted`} />
      ))}
    </div>
  );
}
