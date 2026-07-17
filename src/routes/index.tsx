import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquare, Sparkles, Globe, Zap, Send, Loader2, ArrowRight } from "lucide-react";
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
    return <div className="min-h-screen gradient-mesh grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="relative min-h-screen overflow-hidden aurora-bg">
      {/* Ambient orbs */}
      <div className="aurora-orb h-[420px] w-[420px] -left-32 -top-32 bg-[oklch(0.65_0.22_300)]" />
      <div className="aurora-orb h-[380px] w-[380px] right-[-120px] top-40 bg-[oklch(0.65_0.20_200)]" style={{ animationDelay: "-4s" }} />
      <div className="aurora-orb h-[500px] w-[500px] left-1/3 bottom-[-200px] bg-[oklch(0.65_0.22_340)]" style={{ animationDelay: "-8s" }} />
      <div className="pointer-events-none absolute inset-0 grid-veil opacity-60" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground text-lg leading-none font-semibold shadow-soft" aria-hidden="true">ꯃ</span>
          <span>Manipuri AI <sup className="ml-0.5 text-[10px] font-semibold text-muted-foreground">v1.1</sup></span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link to="/auth"><Button variant="ghost">Sign in</Button></Link>
          <Link to="/try"><Button>Chat now</Button></Link>
        </nav>
      </header>

      <div className="relative mx-auto max-w-6xl px-6 pt-4 text-center">
        <p className="font-display text-base md:text-lg font-semibold tracking-tight text-foreground/90">
          ManipuriAI na Adombu Taramna Okchari 🙏
        </p>
      </div>

      <main className="relative mx-auto max-w-6xl px-6 pb-24 pt-14 md:pt-20">
        <section className="mx-auto max-w-4xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-foreground/90 pill-shimmer">
            <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.75_0.20_300)]" />
            Meiteilon · English · One AI
          </span>

          <h1 className="mt-8 font-display text-6xl font-extrabold tracking-tight md:text-7xl lg:text-8xl leading-[0.95]">
            <span className="hero-title">Chat with AI</span>
            <br />
            <span className="text-foreground/95">in </span>
            <span className="hero-title">Manipuri</span>
            <span className="text-foreground/95"> &amp; English.</span>
          </h1>

          <p className="mx-auto mt-8 max-w-2xl text-lg text-muted-foreground md:text-xl">
            Manipuri AI understands what you write in Meiteilon or English and replies in the same language —
            <span className="text-foreground"> fluently, respectfully</span>, with markdown &amp; code.
          </p>

          <div className="mt-12 flex flex-col items-center justify-center gap-5">
            <Link to="/try" aria-label="Start chatting now" className="group">
              <button className="cta-mega inline-flex items-center gap-4 rounded-full px-10 py-6 text-xl font-bold md:px-16 md:py-8 md:text-2xl">
                <MessageSquare className="h-7 w-7 md:h-8 md:w-8" strokeWidth={2.5} />
                Chat Now
                <span className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-[oklch(0.15_0_0)/0.15] transition-transform group-hover:translate-x-1 md:h-11 md:w-11">
                  <ArrowRight className="h-5 w-5 md:h-6 md:w-6" strokeWidth={2.5} />
                </span>
              </button>
            </Link>
            <Link to="/auth" className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              or sign in to save your chats →
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Free to try</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> No card needed</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400" /> Meitei Mayek supported</span>
          </div>
        </section>

        <section className="mt-28 grid gap-5 md:grid-cols-3">
          {[
            { icon: Globe, title: "Bilingual by design", body: "Auto-detects Manipuri or English and replies in the same language. Switch anytime.", tint: "300" },
            { icon: Zap, title: "Fast & modern", body: "Streaming-style typing, markdown, code blocks with syntax hints, ChatGPT-like feel.", tint: "210" },
            { icon: Sparkles, title: "Made for Manipur", body: "Culturally aware answers with support for Meitei Mayek, Bengali script, and Latin transliteration.", tint: "340" },
          ].map(({ icon: Icon, title, body, tint }, i) => (
            <div key={title} className="card-glow rounded-3xl p-7" style={{ animationDelay: `${i * 0.15}s` }}>
              <div
                className="grid h-12 w-12 place-items-center rounded-2xl float-y"
                style={{
                  background: `linear-gradient(135deg, oklch(0.70 0.18 ${tint} / 0.35), oklch(0.60 0.16 ${tint} / 0.15))`,
                  boxShadow: `0 8px 24px -8px oklch(0.65 0.20 ${tint} / 0.5)`,
                  animationDelay: `${i * 0.4}s`,
                }}
              >
                <Icon className="h-6 w-6 text-foreground" />
              </div>
              <h3 className="mt-5 font-display text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="relative border-t border-border/60 py-10 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Manipuri AI · Built with care for Meiteilon speakers.
        <div className="mt-1 font-semibold tracking-[0.2em] text-foreground">DEVELOPED BY LEONATH</div>
        <a
          href="https://t.me/MrLeona"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow ring-2 ring-primary/40 ring-offset-2 ring-offset-background transition hover:scale-105 hover:brightness-110"
        >
          <Send className="h-4 w-4" /> Contact Developer
        </a>
      </footer>
    </div>
  );
}
