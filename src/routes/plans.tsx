import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Sparkles } from "lucide-react";
import { PLAN_LIMITS, type Plan } from "@/lib/plans";
import { toast } from "sonner";

export const Route = createFileRoute("/plans")({
  head: () => ({ meta: [{ title: "Plans & pricing — Manipuri AI" }, { name: "description", content: "Choose the Manipuri AI plan that fits you: Free, Pro, or Max." }] }),
  component: PlansPage,
});

function PlansPage() {
  const order: Plan[] = ["free", "pro", "max"];
  return (
    <div className="min-h-screen gradient-mesh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" /></span>
          Manipuri AI
        </Link>
        <Link to="/chat"><Button variant="ghost">Back to chat</Button></Link>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">Simple plans for every user</h1>
          <p className="mt-4 text-muted-foreground">Start free. Upgrade when you need more.</p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {order.map((p) => {
            const info = PLAN_LIMITS[p];
            const featured = p === "pro";
            return (
              <Card key={p} className={`relative p-6 ${featured ? "ring-2 ring-primary shadow-glow" : "shadow-soft"}`}>
                {featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    Most popular
                  </span>
                )}
                <h3 className="font-display text-xl font-bold">{info.label}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-bold">{info.price}</span>
                  <span className="text-sm text-muted-foreground">/ month</span>
                </div>
                <ul className="mt-6 space-y-2 text-sm">
                  {info.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-6 w-full"
                  variant={featured ? "default" : "outline"}
                  onClick={() => toast.info(p === "free" ? "You're on the Free plan." : "Payments are coming soon.")}
                >
                  {p === "free" ? "Current plan" : `Upgrade to ${info.label}`}
                </Button>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
