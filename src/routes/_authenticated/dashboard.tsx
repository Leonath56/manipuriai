import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthedShell } from "@/components/AuthedShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PLAN_LIMITS, type Plan } from "@/lib/plans";
import { MessageSquare, Sparkles, CreditCard, ArrowUpRight, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Manipuri AI" }] }),
  component: Dashboard,
});

function Dashboard() {
  const profileQ = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").maybeSingle();
      return data;
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const usageQ = useQuery({
    queryKey: ["usage", today],
    queryFn: async () => {
      const { data } = await supabase.from("daily_usage").select("message_count").eq("usage_date", today).maybeSingle();
      return data?.message_count ?? 0;
    },
  });

  const recentQ = useQuery({
    queryKey: ["recent-chats"],
    queryFn: async () => {
      const { data } = await supabase.from("chats").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(5);
      return data ?? [];
    },
  });

  const plan = (profileQ.data?.plan as Plan) ?? "free";
  const limit = PLAN_LIMITS[plan];
  const used = usageQ.data ?? 0;
  const remaining = Math.max(0, limit.dailyMessages - used);

  return (
    <AuthedShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="font-display text-3xl font-bold">Welcome back{profileQ.data?.full_name ? `, ${profileQ.data.full_name.split(" ")[0]}` : ""}</h1>
              <p className="mt-1 text-sm text-muted-foreground">Your Manipuri AI dashboard</p>
            </div>
            <Link to="/chat"><Button><MessageSquare className="mr-2 h-4 w-4" /> New chat</Button></Link>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <StatCard label="Current plan" value={limit.label} sub={`${limit.dailyMessages} messages / day`} icon={<Sparkles className="h-5 w-5" />} />
            <StatCard label="Messages today" value={String(used)} sub={`${remaining} remaining`} icon={<MessageSquare className="h-5 w-5" />} />
            <StatCard label="Upgrade" value={plan === "max" ? "You're on Max" : "Get more"} sub={plan === "max" ? "Enjoy the top tier" : "Faster & unlimited"} icon={<CreditCard className="h-5 w-5" />} actionTo="/plans" />
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold">Recent chats</h2>
              <Link to="/chat" className="text-sm text-primary hover:underline">View all</Link>
            </div>
            <div className="mt-3 grid gap-2">
              {recentQ.data && recentQ.data.length === 0 && (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  No chats yet. <Link to="/chat" className="text-primary hover:underline">Start one</Link>.
                </Card>
              )}
              {recentQ.data?.map((c) => (
                <Link key={c.id} to="/chat/$chatId" params={{ chatId: c.id }}>
                  <Card className="flex items-center justify-between p-4 transition-colors hover:bg-accent/20">
                    <div className="flex items-center gap-3">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium">{c.title}</div>
                        <div className="text-xs text-muted-foreground">{new Date(c.updated_at).toLocaleString()}</div>
                      </div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AuthedShell>
  );
}

function StatCard({ label, value, sub, icon, actionTo }: { label: string; value: string; sub: string; icon: React.ReactNode; actionTo?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-2 font-display text-2xl font-bold">{value}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/30 text-primary">{icon}</div>
      </div>
      {actionTo && (
        <Link to={actionTo}><Button variant="outline" size="sm" className="mt-4 w-full">Manage</Button></Link>
      )}
    </Card>
  );
}
