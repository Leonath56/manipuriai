import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { AuthedShell } from "@/components/AuthedShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Loader2, Zap, Brain } from "lucide-react";
import { streamChat } from "@/lib/chat-stream";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chat/")({
  head: () => ({ meta: [{ title: "New chat — Manipuri AI" }] }),
  component: NewChat,
});

function NewChat() {
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<"auto" | "mni" | "mni-mtei" | "en">("auto");
  const [mode, setMode] = useState<"instant" | "think">("instant");
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      let newChatId: string | null = null;
      let acc = "";
      await streamChat({
        chatId: null,
        message: text,
        language: lang,
        mode,
        onMeta: (m) => {
          newChatId = m.chatId;
          // Seed the messages cache and navigate right away so streaming continues visibly
          qc.setQueryData(["messages", m.chatId], [
            { id: "u-1", role: "user", content: text },
          ]);
          navigate({ to: "/chat/$chatId", params: { chatId: m.chatId } });
        },
        onChunk: (delta) => {
          acc += delta;
          if (newChatId) {
            qc.setQueryData<Array<{ id: string; role: string; content: string }>>(
              ["messages", newChatId],
              [
                { id: "u-1", role: "user", content: text },
                { id: "a-1", role: "assistant", content: acc },
              ],
            );
          }
        },
      });
      qc.invalidateQueries({ queryKey: ["chats"] });
      if (newChatId) qc.invalidateQueries({ queryKey: ["messages", newChatId] });
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
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground text-2xl leading-none font-semibold shadow-glow" aria-hidden="true">
                ꯃ
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

        <Composer input={input} setInput={setInput} onSubmit={submit} sending={sending} inputRef={inputRef} lang={lang} setLang={setLang} mode={mode} setMode={setMode} />
      </div>
    </AuthedShell>
  );
}

export function Composer({
  input, setInput, onSubmit, sending, inputRef, lang, setLang, mode, setMode,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  sending: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  lang: "auto" | "mni" | "mni-mtei" | "en";
  setLang: (v: "auto" | "mni" | "mni-mtei" | "en") => void;
  mode: "instant" | "think";
  setMode: (v: "instant" | "think") => void;
}) {
  return (
    <div className="border-t border-border bg-white">
      <form onSubmit={onSubmit} className="mx-auto max-w-2xl px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="rounded-2xl border border-neutral-300 bg-white p-2 pr-3 shadow-soft focus-within:ring-2 focus-within:ring-neutral-400">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(e as unknown as React.FormEvent); }
            }}
            rows={1}
            placeholder="Message Manipuri AI…"
            className="min-h-11 resize-none border-0 bg-white text-black placeholder:text-neutral-500 px-2 py-2 text-sm focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <div className="flex items-center gap-1">
              <Select value={mode} onValueChange={(v) => setMode(v as "instant" | "think")}>
                <SelectTrigger className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-xs text-muted-foreground hover:bg-secondary">
                  {mode === "instant" ? <Zap className="h-3.5 w-3.5" /> : <Brain className="h-3.5 w-3.5" />}
                  <SelectValue />
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
                <SelectTrigger className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-xs text-muted-foreground hover:bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect language</SelectItem>
                  <SelectItem value="mni">Reply in Manipuri (Latin)</SelectItem>
                  <SelectItem value="mni-mtei">Reply in Manipuri (Meitei Mayek ꯃꯌꯦꯛ)</SelectItem>
                  <SelectItem value="en">Reply in English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="icon" disabled={!input.trim() || sending} className="h-12 w-12 shrink-0 rounded-full bg-black text-white hover:bg-neutral-800 transition-transform active:scale-90">
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 send-fly-target" />}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] whitespace-pre-wrap text-muted-foreground">{"Manipuri AI can make mistakes. Verify important info. DEVELOPED BY LEONATH\n"}</p>
      </form>
    </div>
  );
}
