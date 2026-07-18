import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Download, Copy, RefreshCw, Maximize2, Check } from "lucide-react";
import { toast } from "sonner";

export const ImageResultCard = memo(function ImageResultCard({
  prompt,
  images,
  onRegenerate,
  onCopyPrompt,
}: {
  prompt: string;
  images: string[];
  onRegenerate?: () => void;
  onCopyPrompt?: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      onCopyPrompt?.();
    } catch {
      toast.error("Failed to copy");
    }
  };

  const download = (url: string, i: number) => {
    const a = document.createElement("a");
    a.href = url;
    const safe = prompt.slice(0, 40).replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").toLowerCase() || "image";
    a.download = `${safe}-${i + 1}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const cols = images.length === 1 ? "grid-cols-1" : "grid-cols-2";

  return (
    <div>
      <div className={`grid gap-2 ${cols}`}>
        {images.map((src, i) => (
          <div
            key={i}
            className="group relative overflow-hidden rounded-xl border border-border bg-muted"
          >
            <img
              src={src}
              alt={prompt}
              loading="lazy"
              decoding="async"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 512px"
              className="h-auto w-full cursor-zoom-in object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              onClick={() => setPreview(src)}
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="h-8 w-8 rounded-full"
                onClick={() => setPreview(src)}
                aria-label="Fullscreen"
                title="Fullscreen"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="h-8 w-8 rounded-full"
                onClick={() => download(src, i)}
                aria-label="Download"
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={copyPrompt} className="h-7 gap-1.5 text-xs">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          Copy prompt
        </Button>
        {onRegenerate && (
          <Button size="sm" variant="ghost" onClick={onRegenerate} className="h-7 gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Regenerate
          </Button>
        )}
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl border-0 bg-transparent p-0 shadow-none">
          {preview && (
            <div className="flex flex-col items-center gap-3">
              <img src={preview} alt={prompt} decoding="async" className="max-h-[85vh] w-auto rounded-lg" />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const i = images.indexOf(preview);
                    download(preview, i >= 0 ? i : 0);
                  }}
                  className="gap-1.5"
                >
                  <Download className="h-4 w-4" /> Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});
