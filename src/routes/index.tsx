import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquare, Loader2, ArrowRight, ArrowUpRight, ShieldCheck, Sparkles, Languages, Zap, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Manipuri AI — Bilingual AI chat in Meiteilon & English" },
      { name: "description", content: "The first ChatGPT-style AI that speaks Manipuri (Meiteilon) and English fluently. Free to start." },
    ],
  }),
  component: Landing,
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

function Landing() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(() => hasPersistedSession());

  useEffect(() => {
    (async () => {
      let { data } = await supabase.auth.getSession();
      if (!data.session) {
        const r = await supabase.auth.refreshSession();
        data = r.data;
      }
      if (data.session) navigate({ to: "/chat", replace: true });
      else setChecking(false);
    })().catch(() => setChecking(false));
  }, [navigate]);

  if (checking) {
    return (
      <div className="min-h-screen gradient-mesh grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden aurora-bg">
      <div className="pointer-events-none absolute inset-0 grid-veil opacity-50" />

      {/* Header */}
      <header className="relative z-10 border-b border-white/5">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2.5">
            <span
              className="grid h-9 w-9 place-items-center rounded-full text-lg leading-none font-semibold"
              style={{ background: "linear-gradient(135deg, var(--gold-soft), var(--gold-deep))", color: "oklch(0.16 0.02 60)" }}
              aria-hidden="true"
            >
              ꯃ
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-serif text-xl leading-none tracking-tight" style={{ fontFamily: "var(--font-serif)" }}>
                Manipuri <span className="italic" style={{ color: "var(--gold)" }}>AI</span>
              </span>
              <sup className="text-[10px] font-medium tracking-widest text-muted-foreground">V1.1</sup>
            </div>
          </Link>

          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#capabilities" className="transition-colors hover:text-foreground">Capabilities</a>
            <a href="#preview" className="transition-colors hover:text-foreground">Preview</a>
            <a href="#trust" className="transition-colors hover:text-foreground">Why us</a>
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/auth"><Button variant="ghost" size="sm">Sign in</Button></Link>
            <Link to="/try">
              <Button size="sm" className="rounded-full bg-foreground text-background hover:bg-foreground/90">
                Chat now <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Welcome line */}
      <div className="relative z-10 mx-auto max-w-7xl px-6 pt-10 text-center">
        <p className="welcome-rainbow text-2xl leading-snug md:text-3xl">
          Manipuri AI na Adombu Taramna Okchari 🙏
        </p>
      </div>

      {/* Hero */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 pb-24 pt-10 md:pt-16">
        <section className="flex flex-col items-center gap-14">
          {/* Left: headline */}
          <div className="w-full max-w-3xl flex flex-col items-center text-center">

            <div className="flex items-center gap-3">
              <span className="h-px w-8 bg-white/20" />
              <span className="eyebrow">Meiteilon · English · Meitei Mayek</span>
              <span className="h-px w-8 bg-white/20" />
            </div>

            <h1
              className="mt-6 text-[46px] leading-[1.02] tracking-tight md:text-[76px]"
              style={{ fontFamily: "var(--font-serif)", fontWeight: 400 }}
            >
              <span className="hero-title">The AI that speaks</span>
              <br />
              <span className="hero-italic italic">your language.</span>
            </h1>

            <p className="mt-7 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              Manipuri AI reads what you write in Meiteilon or English and replies in the same language —
              <span className="text-foreground/90"> fluently, respectfully</span>, with markdown, code and cultural nuance.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
              <Link to="/try" aria-label="Start chatting now" className="group">
                <button className="cta-mega inline-flex items-center gap-3 rounded-full px-8 py-4 text-base font-semibold md:px-10 md:py-5 md:text-lg">
                  <MessageSquare className="h-5 w-5" strokeWidth={2.25} />
                  Chat Now
                  <span className="ml-1 grid h-8 w-8 place-items-center rounded-full transition-transform group-hover:translate-x-1" style={{ background: "oklch(0.16 0.02 60 / 0.15)" }}>
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </span>
                </button>
              </Link>
              <Link to="/auth" className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Sign in to save your chats →
              </Link>
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" style={{ color: "var(--gold)" }} /> No card needed
              </span>
              <span className="inline-flex items-center gap-2">
                <Zap className="h-3.5 w-3.5" style={{ color: "var(--gold)" }} /> Streams live, word by word
              </span>
              <span className="inline-flex items-center gap-2">
                <Languages className="h-3.5 w-3.5" style={{ color: "var(--gold)" }} /> Latin, Bengali & Meitei Mayek
              </span>
            </div>
          </div>


          {/* Right: mock chat preview */}
          <div id="preview" className="w-full max-w-xl mx-auto">

            <div className="chat-card p-5 md:p-6">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold" style={{ background: "linear-gradient(135deg, var(--gold-soft), var(--gold-deep))", color: "oklch(0.16 0.02 60)" }}>ꯃ</span>
                  <span className="text-xs font-medium text-foreground/90">Manipuri AI</span>
                  <span className="ml-1 rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground">live</span>
                </div>
                <div className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-white/15" />
                  <span className="h-2 w-2 rounded-full bg-white/15" />
                  <span className="h-2 w-2 rounded-full" style={{ background: "var(--gold)" }} />
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md msg-user px-4 py-2.5 text-sm">
                  Nangna Manipur gi puwari nungshi ba kari?
                </div>
                <div className="mr-auto max-w-[92%] rounded-2xl rounded-tl-md msg-ai px-4 py-3 text-sm leading-relaxed">
                  <span className="mb-1 block text-[10px] uppercase tracking-widest" style={{ color: "var(--gold)" }}>Meiteilon</span>
                  Manipur gi puwarida <span className="italic">Kangleipak</span> haiba mafamdagi houraga, Ningthouja, Angom, Luwang, Khuman, Moirang amasung Chenglei — saphu lai-narol taret asi loinana leipaki. Kanglei Ipak gi wari asi <span style={{ color: "var(--gold-soft)" }}>2000+</span> chahi henna aduga...
                  <span className="ml-1 inline-block h-3 w-2 translate-y-0.5 animate-pulse" style={{ background: "var(--gold)" }} />
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-2">
                <input
                  disabled
                  placeholder="Type in Manipuri or English…"
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
                />
                <button className="grid h-7 w-7 place-items-center rounded-full" style={{ background: "var(--gold)", color: "oklch(0.16 0.02 60)" }}>
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <p className="mt-3 text-center text-xs text-muted-foreground">
              Live sample — actual replies stream token-by-token.
            </p>

          </div>
        </section>

        {/* Divider */}
        <div className="divider-hair my-24" />

        {/* Capabilities */}
        <section id="capabilities">
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-white/20" />
            <span className="eyebrow">What it does</span>
          </div>
          <h2 className="mt-4 max-w-3xl text-3xl leading-[1.1] tracking-tight md:text-5xl" style={{ fontFamily: "var(--font-serif)" }}>
            Built for Manipur, <span className="italic" style={{ color: "var(--gold)" }}>engineered for everyone.</span>
          </h2>

          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/5 md:grid-cols-3">
            {[
              { n: "01", icon: Languages, title: "Bilingual by design", body: "Auto-detects Manipuri or English and replies in the same script. Switch mid-sentence — it keeps up." },
              { n: "02", icon: Zap, title: "Live streaming replies", body: "Word-by-word rendering with markdown, code blocks and syntax hints. Feels instant." },
              { n: "03", icon: Sparkles, title: "Culturally aware", body: "Understands Meiteilon SOV grammar, Meitei Mayek script and Manipur-specific context." },
            ].map(({ n, icon: Icon, title, body }) => (
              <div key={title} className="group relative bg-background p-8 transition-colors hover:bg-white/[0.02]">
                <div className="flex items-start justify-between">
                  <span className="text-xs font-medium tracking-widest text-muted-foreground">{n}</span>
                  <Icon className="h-5 w-5" style={{ color: "var(--gold)" }} />
                </div>
                <h3 className="mt-8 text-xl tracking-tight" style={{ fontFamily: "var(--font-serif)" }}>{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust bar */}
        <section id="trust" className="mt-24 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-10 md:p-14">
          <div className="grid gap-10 md:grid-cols-4">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3">
                <span className="h-px w-8 bg-white/20" />
                <span className="eyebrow">Why us</span>
              </div>
              <h3 className="mt-4 text-2xl leading-tight md:text-3xl" style={{ fontFamily: "var(--font-serif)" }}>
                The first AI that treats Meiteilon as a <span className="italic" style={{ color: "var(--gold)" }}>first-class language</span> — not a translation afterthought.
              </h3>
            </div>
            <Stat k="3" label="Scripts supported" sub="Latin · Bengali · Meitei Mayek" />
            <Stat k="24/7" label="Availability" sub="Streaming responses, always on" />
          </div>
        </section>

        {/* Final CTA */}
        <section className="mt-24 text-center">
          <h2 className="mx-auto max-w-3xl text-4xl leading-[1.05] tracking-tight md:text-6xl" style={{ fontFamily: "var(--font-serif)" }}>
            Start a conversation in <span className="italic" style={{ color: "var(--gold)" }}>Manipuri</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-muted-foreground">
            Free to try. No card. Sign in only if you want to save your chats.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link to="/try" className="group">
              <button className="cta-mega inline-flex items-center gap-3 rounded-full px-10 py-5 text-lg font-semibold">
                <MessageSquare className="h-5 w-5" strokeWidth={2.25} />
                Chat Now
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2.5} />
              </button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Manipuri AI · Built with care for Meiteilon speakers.
            </div>
            <div className="text-[10px] font-semibold tracking-[0.28em]" style={{ color: "var(--gold)" }}>
              DEVELOPED BY LEONATH
            </div>
            <a
              href="https://t.me/MrLeona"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs font-medium text-foreground/90 transition hover:border-white/30 hover:bg-white/5"
            >
              <Send className="h-3.5 w-3.5" style={{ color: "var(--gold)" }} /> Contact Developer
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Stat({ k, label, sub }: { k: string; label: string; sub: string }) {
  return (
    <div>
      <div className="text-4xl leading-none tracking-tight md:text-5xl" style={{ fontFamily: "var(--font-serif)", color: "var(--gold)" }}>
        {k}
      </div>
      <div className="mt-3 text-sm font-medium text-foreground">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
