import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { MessageSquare, Sparkles, Globe, Zap, Send } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Manipuri AI — Bilingual AI chat in Meiteilon & English" },
      { name: "description", content: "The first ChatGPT-style AI that speaks Manipuri (Meiteilon) and English fluently. Free to start." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen gradient-mesh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground text-lg leading-none font-semibold shadow-soft" aria-hidden="true">ꯃ</span>
          Manipuri AI
        </Link>
        <nav className="flex items-center gap-2">
          <Link to="/auth"><Button variant="ghost">Sign in</Button></Link>
          <Link to="/try"><Button>Get started</Button></Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-16 md:pt-24">
        <section className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Meiteilon · English · One AI
          </span>
          <h1 className="mt-6 font-display text-5xl font-bold tracking-tight md:text-6xl">
            Chat with AI in <span className="text-primary">Manipuri</span> and English.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            Manipuri AI understands what you write in Meiteilon or English and replies in the same language — fluently, respectfully, with markdown and code support.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/try">
              <Button size="lg" className="gap-2"><MessageSquare className="h-4 w-4" /> Get started</Button>
            </Link>
            <Link to="/auth">
              <Button size="lg" variant="outline">Sign in</Button>
            </Link>
          </div>


        </section>

        <section className="mt-24 grid gap-4 md:grid-cols-3">
          {[
            { icon: Globe, title: "Bilingual by design", body: "Auto-detects Manipuri or English and replies in the same language. Switch anytime." },
            { icon: Zap, title: "Fast & modern", body: "Streaming-style typing, markdown, code blocks with syntax hints, and a clean ChatGPT-like feel." },
            { icon: Sparkles, title: "Made for Manipur", body: "Culturally aware answers with support for Meitei Mayek, Bengali script, and Latin transliteration." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/40 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Manipuri AI · Built with care for Meiteilon speakers.
        <div className="mt-1 font-semibold tracking-wider text-foreground">DEVELOPED BY LEONATH</div>
        <a
          href="https://t.me/MrLeona"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow ring-2 ring-primary/40 ring-offset-2 ring-offset-background transition hover:scale-105 hover:brightness-110 animate-pulse"
        >
          <Send className="h-4 w-4" /> Contact Developer
        </a>
      </footer>
    </div>
  );
}
