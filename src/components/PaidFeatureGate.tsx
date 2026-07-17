import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Lock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

type Plan = "free" | "pro" | "max";

export function usePlan() {
  return useQuery({
    queryKey: ["profile-plan"],
    queryFn: async (): Promise<Plan> => {
      const { data } = await supabase.from("profiles").select("plan").maybeSingle();
      return ((data?.plan as Plan | undefined) ?? "free");
    },
    staleTime: 30_000,
  });
}

export function PaidFeatureGate({
  feature,
  description,
  children,
}: {
  feature: string;
  description: string;
  children: ReactNode;
}) {
  const { data: plan, isLoading } = usePlan();
  if (isLoading) {
    return <div className="grid min-h-[40vh] place-items-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (plan === "pro" || plan === "max") return <>{children}</>;

  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="mb-2 font-display text-2xl font-bold">{feature} is a Pro feature</h1>
        <p className="mb-6 text-sm text-muted-foreground">{description}</p>
        <Link to="/plans">
          <Button className="w-full gap-2">
            <Sparkles className="h-4 w-4" /> Upgrade to Pro
          </Button>
        </Link>
        <p className="mt-3 text-xs text-muted-foreground">You are on the Free plan.</p>
      </div>
    </div>
  );
}
