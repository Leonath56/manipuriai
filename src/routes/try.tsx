import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageSquare, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Composer, ThinkingLoader } from "@/components/chat-shared";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { TryPageSkeleton } from "@/components/skeletons";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const GUEST_LIMIT = 3;
const NAME_KEY = "manipuri_guest_name";
const COUNT_KEY = "manipuri_guest_count";
const GUEST_ID_KEY = "manipuri_guest_id";

type Msg = { role: "user" | "assistant"; content: string; images?: string[] };
type Language = "auto" | "mni" | "mni-mtei" | "en";
type Mode = "instant" | "think";

function getOrCreateGuestId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `g_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

function hasPersistedSession() {
  if (typeof window === "undefined") return false;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith("sb-") && key.endsWith("-auth-token")) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export const Route = createFileRoute("/try")({
  head: () => ({
    links: [{ rel: "canonical", href: "https://manipuriai.online/try" }],
    meta: [
      { title: "Try Manipuri AI Free — Chat in Meiteilon" },
      { name: "description", content: "Try the full Manipuri AI chat interface with three free messages in Meiteilon, Meitei Mayek or English." },
      { property: "og:title", content: "Try Manipuri AI Free — Chat in Meiteilon" },
      { property: "og:description", content: "Chat in Manipuri or English instantly — no account needed." },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://manipuriai.online/og-image.jpg?v=6" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://manipuriai.online/og-image.jpg?v=6" },
    ],
  }),
  pendingComponent: () => <TryPageSkeleton />,
  pendingMs: 60,
  pendingMinMs: 220,
  component: TryPage,
});

function TrialSidebar({ onSignIn }: { onSignIn: () => void }) {
  return (
    <aside className="hidden h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex items-center gap-2 px-4 py-4 font-display text-[15px] font-semibold">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-base text-primary-foreground">ꯃ</span>
        <span>Manipuri AI</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">v1.2</span>
      </div>
      <div className="space-y-1.5 px-3">
        <Button variant="outline" className="w-full justify-start gap-2.5 border-sidebar-border bg-sidebar-accent/50" onClick={() => window.location.reload()}>
          <Plus className="h-4 w-4 text-gold" /> New chat
        </Button>
        <Button variant="outline" className="w-full justify-start gap-2.5 border-sidebar-border bg-sidebar-accent/50" onClick={onSignIn}>
          <Sparkles className="h-4 w-4 text-gold" /> Create image
        </Button>
      </div>
      <div className="mt-5 px-5 text-xs font-medium text-muted-foreground">Trial conversation</div>
      <div className="mx-2 mt-2 flex items-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2.5 text-sm">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" /> Free chat
      </div>
      <div className="mt-auto border-t border-sidebar-border p-3">
        <Button className="w-full" onClick={onSignIn}>Sign in to save chats</Button>
      </div>
    </aside>
  );
}

function TryPage() {
  const navigate = useNavigate();
  const [name, setName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(() => hasPersistedSession());
  const [lang, setLang] = useState<Language>("auto");
  const [mode, setMode] = useState<Mode>("instant");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const signIn = () => navigate({ to: "/auth", search: { mode: "signup" } });

  useEffect(() => {
    const savedName = localStorage.getItem(NAME_KEY);
    const savedCount = Number.parseInt(localStorage.getItem(COUNT_KEY) ?? "0", 10) || 0;
    if (savedName) setName(savedName);
    setCount(savedCount);
    if (!hasPersistedSession()) {
      setChecking(false);
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/chat", replace: true });
      else setChecking(false);
    }).catch(() => setChecking(false));
  }, [navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const submitName = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = nameInput.trim();
    if (!clean) return toast.error("Please enter your name");
    if (clean.length > 60) return toast.error("Name too long");
    localStorage.setItem(NAME_KEY, clean);
    setName(clean);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && images.length === 0) || loading || !name) return;
    if (count >= GUEST_LIMIT) return signIn();

    const sentImages = [...images];
    const history = messages.slice(-6).map((message) => ({
      role: message.role,
      content: message.images?.length ? `${message.content}\n\n[attached image]` : message.content,
    }));
    const assistantIndex = messages.length + 1;
    setMessages((current) => [...current, { role: "user", content: text, images: sentImages }, { role: "assistant", content: "" }]);
    setInput("");
    setImages([]);
    setLoading(true);

    try {
      const response = await fetch("/api/public/guest-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          guestId: getOrCreateGuestId(),
          history,
          message: sentImages.length ? `${text}\n\n[attached image]` : text,
          images: sentImages,
          language: lang,
          mode,
        }),
      });
      if (response.status === 429) {
        setMessages((current) => current.slice(0, -2));
        setCount(GUEST_LIMIT);
        localStorage.setItem(COUNT_KEY, String(GUEST_LIMIT));
        toast.info("Your free trial is complete. Sign in to keep chatting.");
        signIn();
        return;
      }
      if (!response.ok || !response.body) throw new Error((await response.text()).slice(0, 200) || "Request failed");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true }).replace(/\u200B/g, "");
        if (!chunk) continue;
        setMessages((current) => {
          const next = [...current];
          const assistant = next[assistantIndex];
          if (assistant) next[assistantIndex] = { ...assistant, content: assistant.content + chunk };
          return next;
        });
      }
      const nextCount = count + 1;
      setCount(nextCount);
      localStorage.setItem(COUNT_KEY, String(nextCount));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
      setMessages((current) => current.slice(0, -2));
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void sendMessage();
  };

  if (checking) return <TryPageSkeleton />;

  if (!name) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4 py-10">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-6 flex items-center justify-center gap-2 font-display text-xl font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">ꯃ</span>
            Manipuri AI
          </Link>
          <Card className="p-6 shadow-soft">
            <h1 className="text-center font-display text-2xl font-bold">What should I call you?</h1>
            <p className="mt-2 text-center text-sm text-muted-foreground">Enter your name to try the full chat interface with {GUEST_LIMIT} free messages.</p>
            <form onSubmit={submitName} className="mt-6 space-y-3">
              <Input autoFocus required maxLength={60} placeholder="Your name" value={nameInput} onChange={(event) => setNameInput(event.target.value)} />
              <Button type="submit" className="w-full">Start chatting</Button>
            </form>
            <p className="mt-4 text-center text-xs text-muted-foreground">Already have an account? <Link to="/auth" className="text-primary hover:underline">Sign in</Link></p>
          </Card>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, GUEST_LIMIT - count);
  const locked = remaining === 0;
  const suggestions = [
    { title: "Meiteilon homework mateng pangbiyu", prompt: "Explain this Meiteilon grammar for me." },
    { title: "Meitei Mayek script tamba", prompt: "How do I write my name in Meitei Mayek?" },
    { title: "Translate English to Manipuri", prompt: "Translate: 'May you have a wonderful day' into native Meiteilon." },
    { title: "Manipur-gi history wari", prompt: "Tell me an interesting story from Manipur's history." },
  ];

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      <TrialSidebar onSignIn={signIn} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/85 px-3 backdrop-blur md:px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2 font-display font-semibold">
            <ArrowLeft className="h-4 w-4 md:hidden" />
            <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-base text-primary-foreground md:hidden">ꯃ</span>
            <span>Manipuri AI</span>
            <span className="rounded-full border border-gold/25 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-gold">v1.2</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground"><strong className="font-semibold text-foreground">{remaining}</strong> / {GUEST_LIMIT} free</span>
            <Button size="sm" className="h-9" onClick={signIn}>Sign in</Button>
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className={`mx-auto max-w-3xl px-4 py-6 sm:py-10 ${messages.length === 0 ? "flex min-h-full flex-col justify-start sm:justify-center" : ""}`}>
            <h1 className="sr-only">Try Manipuri AI in Meiteilon or English</h1>
            {messages.length === 0 && (
              <>
                <div className="text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground shadow-glow">ꯃ</div>
                  <h2 className="mt-3 font-display text-2xl font-semibold sm:mt-4 sm:text-3xl"><span className="font-mayek">ꯈꯨꯔꯨꯝꯖꯔꯤ</span>, {name}!</h2>
                  <p className="mx-auto mt-2.5 max-w-md text-sm leading-relaxed text-muted-foreground">Write in Manipuri, Meitei Mayek or English. Attach a photo and ask about it.</p>
                </div>
                <ul className="mt-6 grid gap-2 sm:mt-9 sm:grid-cols-2">
                  {suggestions.map((suggestion, index) => (
                    <li key={suggestion.title} className={index >= 2 ? "hidden sm:list-item" : undefined}>
                      <button type="button" onClick={() => { setInput(suggestion.prompt); inputRef.current?.focus(); }} className="h-full w-full rounded-xl border border-border bg-card p-3.5 text-left hover:border-gold/40 hover:bg-accent">
                        <span className="block text-sm font-medium">{suggestion.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{suggestion.prompt}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {messages.length > 0 && (
              <div className="space-y-7">
                {messages.map((message, index) => (
                  <Message
                    key={`${message.role}-${index}`}
                    from={message.role}
                    className={message.role === "assistant" ? "msg-in flex-row items-start gap-3" : "msg-in"}
                  >
                    {message.role === "assistant" && <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-base font-semibold text-primary-foreground">ꯃ</span>}
                    <MessageContent>
                      {message.images?.length ? (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {message.images.map((image, imageIndex) => <img key={imageIndex} src={image} alt={`Attachment ${imageIndex + 1}`} className="h-20 w-20 rounded-lg border border-border object-cover" />)}
                        </div>
                      ) : null}
                      {message.role === "assistant" ? (message.content ? <ChatMarkdown content={message.content} /> : <ThinkingLoader />) : <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{message.content}</p>}
                    </MessageContent>
                  </Message>
                ))}
                <div aria-hidden="true" className="h-[clamp(8rem,22svh,14rem)]" />
              </div>
            )}
          </div>
        </div>

        <Composer
          input={input} setInput={setInput}
          images={images} setImages={setImages}
          onSubmit={locked ? (event) => { event.preventDefault(); signIn(); } : submit}
          sending={loading} inputRef={inputRef}
          lang={lang} setLang={setLang} mode={mode} setMode={setMode}
          onRequestDictation={signIn} onRequestImage={signIn} onRequestVoice={signIn}
          placeholder={locked ? "Sign in to keep chatting…" : "Message Manipuri AI…"}
          footerText={locked ? "Free trial used — sign in to continue" : `${remaining} of ${GUEST_LIMIT} free messages left · Manipuri AI can make mistakes`}
        />
      </main>
    </div>
  );
}
