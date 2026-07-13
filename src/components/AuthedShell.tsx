import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Plus, MessageSquare, MoreHorizontal, Pencil, Trash2, LogOut, User, LayoutDashboard, CreditCard, Search, Pin, PinOff, Shield } from "lucide-react";
import { isAdmin as isAdminFn } from "@/lib/admin.functions";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { deleteChat, renameChat, togglePinChat } from "@/lib/chat.functions";
import { toast } from "sonner";

type ChatRow = { id: string; title: string; updated_at: string; pinned: boolean };

export function ChatSidebar({ onClose }: { onClose?: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const chatsQ = useQuery({
    queryKey: ["chats"],
    queryFn: async (): Promise<ChatRow[]> => {
      const { data, error } = await supabase
        .from("chats")
        .select("id, title, updated_at, pinned")
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChatRow[];
    },
  });

  const profileQ = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name, username, email, plan, avatar_url").maybeSingle();
      return data;
    },
  });

  const checkAdmin = useServerFn(isAdminFn);
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => checkAdmin(), staleTime: 60_000 });

  const renameFn = useServerFn(renameChat);
  const deleteFn = useServerFn(deleteChat);
  const pinFn = useServerFn(togglePinChat);

  const renameM = useMutation({
    mutationFn: (v: { chatId: string; title: string }) => renameFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chats"] }),
  });
  const deleteM = useMutation({
    mutationFn: (chatId: string) => deleteFn({ data: { chatId } }),
    onSuccess: (_, chatId) => {
      qc.invalidateQueries({ queryKey: ["chats"] });
      if (pathname.includes(chatId)) navigate({ to: "/chat" });
    },
  });
  const pinM = useMutation({
    mutationFn: (v: { chatId: string; pinned: boolean }) => pinFn({ data: v }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["chats"] });
      toast.success(v.pinned ? "Pinned" : "Unpinned");
    },
  });

  const filtered = (chatsQ.data ?? []).filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <aside className="flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-4 py-4">
        <Link to="/chat" className="flex items-center gap-2 font-display text-base font-bold" onClick={onClose}>
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground text-base leading-none font-semibold" aria-hidden="true">ꯃ</span>
          Manipuri AI
          <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">v1</span>
        </Link>
      </div>

      <div className="px-3">
        <Link to="/chat" onClick={onClose}>
          <Button variant="outline" className="w-full justify-start gap-2">
            <Plus className="h-4 w-4" /> New chat
          </Button>
        </Link>
      </div>

      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" className="h-9 pl-8 text-sm" />
        </div>
      </div>

      <nav className="mt-3 flex-1 overflow-y-auto px-2 pb-2">
        {chatsQ.isLoading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>}
        {chatsQ.data && filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {search ? "No matches." : "No chats yet. Start a new one!"}
          </div>
        )}
        {(() => {
          const pinned = filtered.filter((c) => c.pinned);
          const recent = filtered.filter((c) => !c.pinned);
          const renderRow = (c: ChatRow) => {
            const active = pathname === `/chat/${c.id}`;
            const isRenaming = renamingId === c.id;
            return (
              <li key={c.id} className={`group flex items-center gap-1 rounded-lg px-1 ${active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"}`}>
                {isRenaming ? (
                  <form
                    className="flex-1 px-1 py-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      renameM.mutate({ chatId: c.id, title: renameValue.trim() || c.title });
                      setRenamingId(null);
                    }}
                  >
                    <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onBlur={() => setRenamingId(null)} className="h-7 text-sm" />
                  </form>
                ) : (
                  <Link to="/chat/$chatId" params={{ chatId: c.id }} onClick={onClose} className="flex flex-1 items-center gap-2 truncate px-2 py-2 text-sm">
                    {c.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-primary" /> : <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{c.title}</span>
                  </Link>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="grid h-7 w-7 shrink-0 place-items-center rounded opacity-0 hover:bg-sidebar-accent group-hover:opacity-100" aria-label="Chat options">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => pinM.mutate({ chatId: c.id, pinned: !c.pinned })}>
                      {c.pinned ? <><PinOff className="mr-2 h-3.5 w-3.5" /> Unpin</> : <><Pin className="mr-2 h-3.5 w-3.5" /> Pin</>}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setRenamingId(c.id); setRenameValue(c.title); }}>
                      <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => {
                        if (confirm("Delete this chat?")) deleteM.mutate(c.id);
                      }}
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          };
          return (
            <>
              {pinned.length > 0 && (
                <>
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pinned</div>
                  <ul className="space-y-0.5">{pinned.map(renderRow)}</ul>
                </>
              )}
              {recent.length > 0 && (
                <>
                  <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent</div>
                  <ul className="space-y-0.5">{recent.map(renderRow)}</ul>
                </>
              )}
            </>
          );
        })()}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-sidebar-accent">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                {(profileQ.data?.full_name ?? profileQ.data?.username ?? profileQ.data?.email ?? "U").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{profileQ.data?.full_name ?? profileQ.data?.username ?? "Account"}</div>
                <div className="truncate text-xs capitalize text-muted-foreground">{profileQ.data?.plan ?? "free"} plan</div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild><Link to="/dashboard"><LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/profile"><User className="mr-2 h-4 w-4" /> Profile</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/plans"><CreditCard className="mr-2 h-4 w-4" /> Plans & billing</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

export function AuthedShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Track last-login once per mount
  useEffect(() => {
    supabase.from("profiles").update({ last_login_at: new Date().toISOString() }).then(() => {});
  }, []);
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      <div className="hidden md:block"><ChatSidebar /></div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0"><ChatSidebar onClose={() => setMobileOpen(false)} /></div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b border-border px-3 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
            <MessageSquare className="h-4 w-4" />
          </Button>
          <span className="font-display font-semibold">Manipuri AI</span>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
