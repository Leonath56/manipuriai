import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { AuthedShell } from "@/components/AuthedShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Sparkles, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { sendMessage } from "@/lib/chat.functions";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chat/")({
  head: () => ({ meta: [{ title: "New chat — Manipuri AI" }] }),
  component: NewChat,
});

function NewChat() {
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<"auto" | "mni" | "en">("auto");
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();
  const send = useServerFn(sendMessage);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const res = await send({ data: { chatId: null, message: input.trim(), language: lang } });
      qc.invalidateQueries({ queryKey: ["chats"] });
      qc.setQueryData(["messages", res.chatId], [
        { id: "u-1", role: "user", content: input.trim() },
        { id: "a-1", role: "assistant", content: res.reply },
      ]);
      navigate({ to: "/chat/$chatId", params: { chatId: res.chatId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setSending(false);
    }
  };

  const suggestions = [
    { title: "Meiteilon greeting", prompt: "Khurumjari! Kadaidagi lakpano?" },
    { title: "Translate to Manipuri", prompt: "Translate to Manipuri: The rain is falling softly today." },
    { title: "Explain in English", prompt: "Explain quantum computing like I'm 12." },
    { title: "Write code", prompt: "Write a JavaScript function to reverse a string." },
  ];

  return (
    <AuthedShell>
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-4 py-10">
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-glow">
                <Sparkles className="h-6 w-6" />
              </div>
              <h1 className="mt-5 font-display text-3xl font-bold">How can I help you today?</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Write in Manipuri (Meiteilon) or English — I'll reply in the same language.
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
          </div>
        </div>

        <Composer input={input} setInput={setInput} onSubmit={submit} sending={sending} inputRef={inputRef} lang={lang} setLang={setLang} />
      </div>
    </AuthedShell>
  );
}

export function Composer({
  input, setInput, onSubmit, sending, inputRef, lang, setLang,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  sending: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  lang: "auto" | "mni" | "en";
  setLang: (v: "auto" | "mni" | "en") => void;
}) {
  return (
    <div className="border-t border-border bg-background/80 backdrop-blur">
      <form onSubmit={onSubmit} className="mx-auto max-w-2xl px-4 py-3">
        <div className="rounded-2xl border border-border bg-card p-2 shadow-soft focus-within:ring-2 focus-within:ring-primary/40">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(e as unknown as React.FormEvent); }
            }}
            rows={1}
            placeholder="Message Manipuri AI…"
            className="min-h-11 resize-none border-0 bg-transparent px-2 py-2 text-sm focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <Select value={lang} onValueChange={(v) => setLang(v as "auto" | "mni" | "en")}>
              <SelectTrigger className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-xs text-muted-foreground hover:bg-secondary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect language</SelectItem>
                <SelectItem value="mni">Reply in Manipuri</SelectItem>
                <SelectItem value="en">Reply in English</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" size="icon" disabled={!input.trim() || sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">Manipuri AI can make mistakes. Verify important info.</p>
      </form>
    </div>
  );
}
