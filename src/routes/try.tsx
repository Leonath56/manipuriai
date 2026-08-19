import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Send, Loader2, Lock, ArrowLeft, ImagePlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const ChatMarkdown = lazy(() =>
  import("@/components/ChatMarkdown").then((m) => ({ default: m.ChatMarkdown })),
);


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

type Msg = { role: "user" | "assistant"; content: string; images?: string[] };

export const Route = createFileRoute("/try")({
  head: () => ({
    links: [{ rel: "canonical", href: "https://manipuriai.online/try" }],
    meta: [
      { title: "Try Manipuri AI — 3 free messages" },
      { name: "description", content: "Try Manipuri AI for free — chat 3 times without signing up. The first bilingual AI for Meiteilon & English." },
      { property: "og:title", content: "Try Manipuri AI — 3 free messages" },
      { property: "og:description", content: "Try Manipuri AI for free — chat 3 times without signing up." },
      { property: "og:image", content: "https://manipuriai.online/og-image.jpg?v=6" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Try Manipuri AI — 3 free messages" },
      { name: "twitter:description", content: "Try Manipuri AI for free — chat 3 times without signing up." },
      { name: "twitter:image", content: "https://manipuriai.online/og-image.jpg?v=6" },
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
  const [images, setImages] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(() => hasPersistedSession());
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);


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
    if ((!text && images.length === 0) || loading || !name) return;
    if (count >= GUEST_LIMIT) {
      navigate({ to: "/auth", search: { mode: "signup" } });
      return;
    }

    const userMsg: Msg = { role: "user", content: text, images: [...images] };
    const historyForApi = messages.slice(-6).map(m => ({
      role: m.role,
      content: m.images?.length 
        ? `${m.content}\n\n[attached image]` 
        : m.content
    }));
    setMessages((m) => [...m, userMsg, { role: "assistant", content: "" }]);
    setInput("");
    setImages([]);
    setLoading(true);

    try {
      const resp = await fetch("/api/public/guest-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          guestId: getOrCreateGuestId(),
          history: historyForApi,
          message: images.length ? `${text}\n\n[attached image]` : text,
          images: images,
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
      let contentBuffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true }).replace(/\u200B/g, "");
        if (!chunk) continue;

        full += chunk;
        contentBuffer += chunk;

        if (contentBuffer.includes(" ") || contentBuffer.includes("\n")) {
          const words = contentBuffer.split(/(\s+)/);
          const lastIsSpace = /\s$/.test(contentBuffer);
          const toEmit = lastIsSpace ? words : words.slice(0, -1);
          contentBuffer = lastIsSpace ? "" : words[words.length - 1];

          for (const word of toEmit) {
            if (word) {
              setMessages((m) => {
                const next = [...m];
                const lastIdx = next.length - 1;
                const last = next[lastIdx];
                next[lastIdx] = { ...last, content: last.content + word };
                return next;
              });
              await new Promise(r => setTimeout(r, 10 + Math.random() * 15));
            }
          }
        }
      }
      if (contentBuffer) {
        setMessages((m) => {
          const next = [...m];
          const lastIdx = next.length - 1;
          const last = next[lastIdx];
          next[lastIdx] = { ...last, content: (last.content || "") + contentBuffer };
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
          {(() => {
            const elements: React.ReactNode[] = [];
            for (let i = 0; i < messages.length; i += 2) {
              const user = messages[i];
              const assistant = messages[i + 1];
              
              if (assistant) {
                elements.push(
                  <div key={`turn-${i}`} className="flex flex-col space-y-4">
                    {/* User prompt first */}
                    <div className="flex justify-end">
                      <div className="inline-block max-w-[85%] rounded-2xl bg-secondary px-4 py-2 text-sm">
                        <div className="space-y-2">
                          {user.images && user.images.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2">
                              {user.images.map((img, idx) => (
                                <img key={idx} src={img} alt="Uploaded" className="h-20 w-20 object-cover rounded-lg border border-border/50" />
                              ))}
                            </div>
                          )}
                          <span className="whitespace-pre-wrap">{user.content}</span>
                        </div>
                      </div>
                    </div>
                    {/* Assistant response below */}
                    <div className="flex justify-start">
                      <div className="max-w-[95%] text-sm">
                        {assistant.content ? (
                          <Suspense fallback={<span className="whitespace-pre-wrap">{assistant.content}</span>}>
                            <ChatMarkdown content={assistant.content} />
                          </Suspense>
                        ) : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      </div>
                    </div>
                  </div>
                );
              } else {
                // ... same single message logic ...
                // Single message (e.g. just user prompt while waiting)
                elements.push(
                  <div key={`turn-${i}`} className="flex justify-end">
                    <div className="inline-block max-w-[85%] rounded-2xl bg-secondary px-4 py-2 text-sm">
                      <div className="space-y-2">
                        {user.images && user.images.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {user.images.map((img, idx) => (
                              <img key={idx} src={img} alt="Uploaded" className="h-20 w-20 object-cover rounded-lg border border-border/50" />
                            ))}
                          </div>
                        )}
                        <span className="whitespace-pre-wrap">{user.content}</span>
                      </div>
                    </div>
                  </div>
                );
              }
            }
            return elements;
          })()}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-white">
        <div className="mx-auto max-w-2xl px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="rounded-2xl border border-neutral-300 bg-white p-2 shadow-soft focus-within:ring-2 focus-within:ring-neutral-400"
          >
            {images.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1">
                {images.map((src, i) => (
                  <div key={i} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-neutral-300 bg-neutral-100">
                    <img src={src} alt="Upload preview" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImages(images.filter((_, idx) => idx !== i))}
                      className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-black text-white shadow"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={async (e) => {
                const items = Array.from(e.clipboardData?.items ?? []);
                const files = items.map(it => it.getAsFile()).filter((f): f is File => !!f && f.type.startsWith("image/"));
                if (files.length) {
                  e.preventDefault();
                  const { readImagesAsDataUrls } = await import("@/components/chat-shared");
                  const urls = await readImagesAsDataUrls(files);
                  setImages(prev => [...prev, ...urls].slice(0, 4));
                }
              }}
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
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = e.target.files;
                    if (files?.length) {
                      const { readImagesAsDataUrls } = await import("@/components/chat-shared");
                      const urls = await readImagesAsDataUrls(files);
                      setImages(prev => [...prev, ...urls].slice(0, 4));
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => fileRef.current?.click()}
                  disabled={loading || images.length >= 4}
                  className="h-8 w-8 shrink-0 rounded-full text-black hover:bg-neutral-100"
                >
                  <ImagePlus className="h-4 w-4" />
                </Button>
                <span className="text-xs text-neutral-500">
                  {locked ? (
                    <>Free trial used — <Link to="/auth" search={{ mode: "signup" }} className="font-medium text-neutral-900 underline">sign up</Link> to continue</>
                  ) : (
                    <>{remaining} / {GUEST_LIMIT} messages left</>
                  )}
                </span>
              </div>
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
