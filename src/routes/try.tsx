import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Send, Loader2, Lock, ArrowLeft } from "lucide-react";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { supabase } from "@/integrations/supabase/client";


const GUEST_LIMIT = 3;
const NAME_KEY = "manipuri_guest_name";
const COUNT_KEY = "manipuri_guest_count";
const GUEST_ID_KEY = "manipuri_guest_id";

function getOrCreateGuestId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `g_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

type Msg = { role: "user" | "assistant"; content: string };

export const Route = createFileRoute("/try")({
  head: () => ({
    meta: [
      { title: "Try Manipuri AI — 3 free messages" },
      { name: "description", content: "Try Manipuri AI for free — chat 3 times without signing up." },
    ],
  }),
  component: TryPage,
});

function hasPersistedSession() {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) return true;
    }
  } catch {}
  return false;
}

function TryPage() {
  const navigate = useNavigate();
  const [name, setName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(() => hasPersistedSession());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedName = localStorage.getItem(NAME_KEY);
    const savedCount = parseInt(localStorage.getItem(COUNT_KEY) ?? "0", 10) || 0;
    if (savedName) setName(savedName);
    setCount(savedCount);

    // Only run the auth check when a persisted Supabase session actually exists.
    // Guests have none, so skip the network call and render instantly.
    if (!hasPersistedSession()) {
      setChecking(false);
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        navigate({ to: "/chat", replace: true });
      } else {
        setChecking(false);
      }
    }).catch(() => setChecking(false));
  }, [navigate]);


  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const submitName = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = nameInput.trim();
    if (clean.length < 1) return toast.error("Please enter your name");
    if (clean.length > 60) return toast.error("Name too long");
    localStorage.setItem(NAME_KEY, clean);
    setName(clean);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || !name) return;
    if (count >= GUEST_LIMIT) {
      navigate({ to: "/auth", search: { mode: "signup" } });
      return;
    }

    const userMsg: Msg = { role: "user", content: text };
    const historyForApi = messages.slice(-6);
    setMessages((m) => [...m, userMsg, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    try {
      const resp = await fetch("/api/public/guest-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          guestId: getOrCreateGuestId(),
          history: historyForApi,
          message: text,
          language: "auto",
        }),
      });

      if (resp.status === 429) {
        setMessages((m) => m.slice(0, -2));
        setCount(GUEST_LIMIT);
        localStorage.setItem(COUNT_KEY, String(GUEST_LIMIT));
        toast.info("You've used your free trial. Sign up to keep chatting.");
        return;
      }

      if (!resp.ok || !resp.body) {
        const err = await resp.text();
        throw new Error(err.slice(0, 200) || "Request failed");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { role: "assistant", content: full };
          return next;
        });
      }

      const newCount = count + 1;
      setCount(newCount);
      localStorage.setItem(COUNT_KEY, String(newCount));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
      setMessages((m) => m.slice(0, -2));
    } finally {
      setLoading(false);
    }
  };

  const remaining = Math.max(0, GUEST_LIMIT - count);
  const locked = count >= GUEST_LIMIT;

  if (checking) {
    return <div className="min-h-screen gradient-mesh grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!name) {
    return (
      <div className="min-h-screen gradient-mesh grid place-items-center px-4 py-10">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-6 flex items-center justify-center gap-2 font-display text-xl font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground text-lg font-semibold" aria-hidden="true">ꯃ</span>
            Manipuri AI
          </Link>
          <Card className="p-6 shadow-soft">
            <h1 className="font-display text-2xl font-bold text-center">What should I call you?</h1>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Enter your name to try Manipuri AI — {GUEST_LIMIT} free messages, no sign-up.
            </p>
            <form onSubmit={submitName} className="mt-6 space-y-3">
              <Input
                autoFocus
                required
                maxLength={60}
                placeholder="Your name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
              />
              <Button type="submit" className="w-full">Start chatting</Button>
            </form>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Already have an account? <Link to="/auth" className="text-primary hover:underline">Sign in</Link>
            </p>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-background overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-display font-bold">
          <ArrowLeft className="h-4 w-4" />
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground text-base font-semibold" aria-hidden="true">ꯃ</span>
          Manipuri AI
        </Link>
        <div className="text-xs text-muted-foreground">
          Guest · <span className="font-medium text-foreground">{remaining}</span> / {GUEST_LIMIT} left
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              <div className="text-5xl mb-4" aria-hidden="true">ꯃ</div>
              <p className="text-lg">Khurumjari, {name}!</p>
              <p className="text-sm mt-1">Kari haiba pambano? Ask me anything in Manipuri or English.</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "inline-block max-w-[85%] rounded-2xl bg-secondary px-4 py-2 text-sm"
                    : "max-w-[95%] text-sm"
                }
              >
                {m.role === "assistant" ? (
                  m.content ? <ChatMarkdown content={m.content} /> : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-white">
        <div className="mx-auto max-w-2xl px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="rounded-2xl border border-neutral-300 bg-white p-2 shadow-soft focus-within:ring-2 focus-within:ring-neutral-400"
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={locked ? "Sign in to keep chatting…" : "Message Manipuri AI…"}
              rows={1}
              style={{ fontSize: "16px" }}
              className="min-h-11 resize-none border-0 bg-white text-black placeholder:text-neutral-500 px-2 py-2 focus-visible:ring-0"
              disabled={loading}
            />
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-xs text-neutral-500">
                {locked ? (
                  <>Free trial used — <Link to="/auth" search={{ mode: "signup" }} className="font-medium text-neutral-900 underline">sign up</Link> to continue</>
                ) : (
                  <>{remaining} / {GUEST_LIMIT} free messages left</>
                )}
              </span>
              <Button
                type="submit"
                size="icon"
                disabled={loading || !input.trim()}
                className="h-10 w-10 rounded-full bg-black text-white hover:bg-neutral-800"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </form>
        </div>
      </div>


    </div>
  );
}
