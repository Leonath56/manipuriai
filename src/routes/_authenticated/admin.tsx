import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AuthedShell } from "@/components/AuthedShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { isAdmin, getAdminOverview, listAdminUsers, listAdminCorrections, getAdminUserConversations } from "@/lib/admin.functions";
import { ArrowLeft, Users, MessageSquare, Sparkles, ShieldAlert, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — Manipuri AI" }] }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const isAdminFn = useServerFn(isAdmin);
  const overviewFn = useServerFn(getAdminOverview);
  const usersFn = useServerFn(listAdminUsers);
  const correctionsFn = useServerFn(listAdminCorrections);
  const convosFn = useServerFn(getAdminUserConversations);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => isAdminFn() });
  const overviewQ = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => overviewFn(),
    enabled: adminQ.data?.isAdmin === true,
  });
  const usersQ = useQuery({
    queryKey: ["admin-users", debounced],
    queryFn: () => usersFn({ data: { search: debounced || undefined } }),
    enabled: adminQ.data?.isAdmin === true,
  });
  const corrQ = useQuery({
    queryKey: ["admin-corrections"],
    queryFn: () => correctionsFn(),
    enabled: adminQ.data?.isAdmin === true,
  });
  const convoQ = useQuery({
    queryKey: ["admin-user-convos", viewUserId],
    queryFn: () => convosFn({ data: { userId: viewUserId! } }),
    enabled: !!viewUserId && adminQ.data?.isAdmin === true,
  });

  const chatMessages = useMemo(() => {
    if (!convoQ.data || !selectedChatId) return [];
    return convoQ.data.messages.filter((m) => m.chat_id === selectedChatId);
  }, [convoQ.data, selectedChatId]);

  // Auto-select first chat when data loads
  useEffect(() => {
    if (convoQ.data && convoQ.data.chats.length > 0 && !selectedChatId) {
      setSelectedChatId(convoQ.data.chats[0].id);
    }
  }, [convoQ.data, selectedChatId]);

  if (adminQ.isLoading) {
    return <AuthedShell><div className="p-8 text-muted-foreground">Checking access…</div></AuthedShell>;
  }
  if (!adminQ.data?.isAdmin) {
    return (
      <AuthedShell>
        <div className="mx-auto max-w-md p-8 text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="mt-4 text-2xl font-semibold">Access denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">This page is only visible to administrators.</p>
          <Button className="mt-6" onClick={() => navigate({ to: "/" })}>Back to chat</Button>
        </div>
      </AuthedShell>
    );
  }

  const o = overviewQ.data;

  return (
    <AuthedShell>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back to chat
            </Link>
            <h1 className="mt-1 text-2xl md:text-3xl font-bold">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground">Overview of Manipuri AI usage.</p>
          </div>
          <Badge variant="secondary">Admin</Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<Users className="h-4 w-4" />} label="Total users" value={o?.totalUsers ?? "…"} />
          <StatCard icon={<MessageSquare className="h-4 w-4" />} label="Total chats" value={o?.totalChats ?? "…"} />
          <StatCard icon={<Sparkles className="h-4 w-4" />} label="Total messages" value={o?.totalMessages ?? "…"} />
          <StatCard icon={<Sparkles className="h-4 w-4" />} label="Messages (7d)" value={o?.messagesLast7d ?? "…"} />
          <StatCard icon={<Sparkles className="h-4 w-4" />} label="Messages today" value={o?.messagesToday ?? "…"} />
          <StatCard icon={<Wand2 className="h-4 w-4" />} label="Corrections" value={o?.totalCorrections ?? "…"} />
          <StatCard icon={<Users className="h-4 w-4" />} label="Free users" value={o?.planCounts.free ?? 0} />
          <StatCard icon={<Users className="h-4 w-4" />} label="Paid users" value={(o?.planCounts.pro ?? 0) + (o?.planCounts.max ?? 0)} />
        </div>

        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Users</h2>
            <Input
              placeholder="Search email, username, name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">User</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Age</th>
                  <th className="py-2 pr-3">Plan</th>
                  <th className="py-2 pr-3">Chats</th>
                  <th className="py-2 pr-3">Msgs</th>
                  <th className="py-2 pr-3">Joined</th>
                  <th className="py-2 pr-3">Last login</th>
                </tr>
              </thead>
              <tbody>
                {(usersQ.data?.users ?? []).map((u) => (
                  <tr key={u.id} className="border-t border-border/40">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{u.full_name || u.username || "—"}</div>
                      {u.roles.includes("admin") && <Badge variant="outline" className="mt-1 text-[10px]">admin</Badge>}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{u.email}</td>
                    <td className="py-2 pr-3">{u.age ?? "—"}</td>
                    <td className="py-2 pr-3 capitalize">{u.plan}</td>
                    <td className="py-2 pr-3">
                      <button
                        className="rounded px-1.5 py-0.5 font-medium text-primary underline-offset-2 hover:underline disabled:opacity-40"
                        disabled={u.chatCount === 0}
                        onClick={() => { setSelectedChatId(null); setViewUserId(u.id); }}
                      >
                        {u.chatCount}
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        className="rounded px-1.5 py-0.5 font-medium text-primary underline-offset-2 hover:underline disabled:opacity-40"
                        disabled={u.messageCount === 0}
                        onClick={() => { setSelectedChatId(null); setViewUserId(u.id); }}
                      >
                        {u.messageCount}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
                {usersQ.isLoading && <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!usersQ.isLoading && (usersQ.data?.users ?? []).length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-lg font-semibold">Recent Manipuri corrections</h2>
          <div className="space-y-3">
            {(corrQ.data?.corrections ?? []).slice(0, 20).map((c) => (
              <div key={c.id} className="rounded-md border border-border/40 p-3 text-sm">
                <div className="text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleString()} · {c.language ?? "—"} · <span className="capitalize">{c.status}</span>
                </div>
                <div className="mt-2"><span className="text-xs font-semibold text-muted-foreground">Original:</span> {c.original_text}</div>
                <div className="mt-1"><span className="text-xs font-semibold text-primary">Corrected:</span> {c.corrected_text}</div>
                {c.note && <div className="mt-1 text-xs text-muted-foreground">Note: {c.note}</div>}
              </div>
            ))}
            {(corrQ.data?.corrections ?? []).length === 0 && !corrQ.isLoading && (
              <div className="py-6 text-center text-muted-foreground text-sm">No corrections yet.</div>
            )}
          </div>
        </Card>
        </div>
      </div>
    </AuthedShell>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon} {label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </Card>
  );
}
