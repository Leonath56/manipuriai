import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Sparkles } from "lucide-react";
import { PLAN_LIMITS, type Plan } from "@/lib/plans";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createRazorpayOrder, verifyRazorpayPayment } from "@/lib/razorpay.functions";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/plans")({
  head: () => ({ meta: [{ title: "Plans & pricing — Manipuri AI" }, { name: "description", content: "Choose the Manipuri AI plan that fits you: Free, Pro, or Max." }] }),
  component: PlansPage,
});

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (evt: string, cb: (resp: unknown) => void) => void };
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

function PlansPage() {
  const order: Plan[] = ["free", "pro", "max"];
  const navigate = useNavigate();
  const createOrder = useServerFn(createRazorpayOrder);
  const verifyPayment = useServerFn(verifyRazorpayPayment);
  const [loading, setLoading] = useState<Plan | null>(null);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { if (!cancelled) setCurrentPlan("free"); return; }
      const { data: p } = await supabase.from("profiles").select("plan").maybeSingle();
      if (!cancelled) setCurrentPlan(((p?.plan as Plan | undefined) ?? "free"));
    })();
    return () => { cancelled = true; };
  }, []);

  const handleUpgrade = async (plan: Plan) => {
    if (plan === "free") {
      toast.info("You're on the Free plan.");
      return;
    }
    setLoading(plan);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        toast.info("Please sign in to upgrade.");
        navigate({ to: "/auth" });
        return;
      }

      const ok = await loadRazorpayScript();
      if (!ok || !window.Razorpay) {
        toast.error("Failed to load payment library. Check your connection.");
        return;
      }

      const orderResp = await createOrder({ data: { plan } });

      const { data: userData } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .maybeSingle();

      const rzp = new window.Razorpay({
        key: orderResp.key_id,
        amount: orderResp.amount,
        currency: orderResp.currency,
        order_id: orderResp.order_id,
        name: "Manipuri AI",
        description: `${PLAN_LIMITS[plan].label} plan subscription`,
        theme: { color: "#a97449" },
        prefill: {
          name: profile?.full_name ?? "",
          email: profile?.email ?? userData.user?.email ?? "",
        },
        modal: {
          ondismiss: () => {
            setLoading(null);
            toast.info("Payment cancelled.");
          },
        },
        handler: async (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          try {
            const verified = await verifyPayment({
              data: {
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              },
            });
            toast.success(`Welcome to ${PLAN_LIMITS[verified.plan as Plan].label}!`);
            setTimeout(() => navigate({ to: "/chat" }), 800);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Verification failed";
            toast.error(msg);
          } finally {
            setLoading(null);
          }
        },
      });

      rzp.on("payment.failed", (resp: unknown) => {
        console.error("payment.failed", resp);
        toast.error("Payment failed. Please try again.");
        setLoading(null);
      });

      rzp.open();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not start payment";
      toast.error(msg);
      setLoading(null);
    }
  };

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
            const isLoading = loading === p;
            const isCurrent = currentPlan === p;
            const planRank: Record<Plan, number> = { free: 0, pro: 1, max: 2 };
            const isDowngrade = currentPlan !== null && planRank[p] < planRank[currentPlan];
            return (
              <Card key={p} className={`relative p-6 ${isCurrent ? "ring-2 ring-primary shadow-glow" : featured ? "ring-2 ring-primary shadow-glow" : "shadow-soft"}`}>
                {isCurrent ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    Current plan
                  </span>
                ) : featured && (
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
                  variant={isCurrent ? "outline" : featured ? "default" : "outline"}
                  disabled={isLoading || isCurrent || isDowngrade || currentPlan === null}
                  onClick={() => handleUpgrade(p)}
                >
                  {isCurrent
                    ? "Current plan"
                    : currentPlan === null
                      ? "Loading…"
                      : isDowngrade
                        ? "Included in your plan"
                        : p === "free"
                          ? "Current plan"
                          : isLoading
                            ? "Loading…"
                            : `Pay ${info.price} with Razorpay`}
                </Button>
              </Card>
            );
          })}
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          Payments are securely processed by Razorpay. Test mode is currently enabled.
        </p>
      </main>
    </div>
  );
}
