import { useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { z } from "zod";
import { Bug, Send, Loader2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const schema = z.object({
  title: z.string().trim().min(3, "Please add a short title").max(120),
  description: z.string().trim().min(10, "Describe the issue (10+ chars)").max(1000),
  email: z.string().trim().email("Invalid email").max(255).optional().or(z.literal("")),
});

const DEV_URL = "https://t.me/MrLeona";

export function ReportIssue() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const buildMessage = () => {
    const pageUrl = typeof window !== "undefined" ? window.location.href : pathname;
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    return [
      `Manipuri AI — Issue Report`,
      ``,
      `Title: ${title}`,
      email ? `From: ${email}` : null,
      ``,
      `Description:`,
      description,
      ``,
      `— Context —`,
      `Page: ${pageUrl}`,
      `Path: ${pathname}`,
      `When: ${new Date().toISOString()}`,
      `UA: ${ua}`,
    ].filter(Boolean).join("\n");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ title, description, email });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    setBusy(true);
    const message = buildMessage();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
        toast.success("Report copied — paste it in Telegram");
      } else {
        toast.message("Opening Telegram", { description: "Paste the details in chat." });
      }
      window.open(DEV_URL, "_blank", "noopener,noreferrer");
      setOpen(false);
      setTitle("");
      setDescription("");
      setEmail("");
    } finally {
      setBusy(false);
    }
  };

  const copyOnly = async () => {
    const parsed = schema.safeParse({ title, description, email });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    await navigator.clipboard?.writeText(buildMessage());
    toast.success("Report copied to clipboard");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Report an issue"
          className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-soft hover:bg-accent/40"
        >
          <Bug className="h-3.5 w-3.5" /> Report an issue
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>
            Sends your report and current page context to the developer on Telegram.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Short summary"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              placeholder="What happened? What did you expect?"
              rows={5}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Your email (optional)</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={255}
              placeholder="you@example.com"
            />
          </div>
          <p className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            We'll include the current page URL and timestamp automatically.
          </p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={copyOnly} disabled={busy}>
              <Copy className="mr-2 h-4 w-4" /> Copy
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send on Telegram
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
