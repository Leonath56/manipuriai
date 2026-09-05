import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, MessageSquare, MoreHorizontal, Pencil, Trash2, LogOut, User, LayoutDashboard, CreditCard, Search, Pin, PinOff, Shield, ImageIcon, Sparkles, PanelLeftClose, PanelLeftOpen, X, Download, FileText, FileJson } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { isAdmin as isAdminFn } from "@/lib/admin.functions";
import { deleteChat, renameChat, togglePinChat } from "@/lib/chat.functions";
import { downloadConversation, type ExportMessage } from "@/lib/export-chat";
import { purgeLegacyResponseCache, clearLocalUserData } from "@/lib/chat-cache";
import { hasMod } from "@/lib/shortcuts";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { toast } from "sonner";

type ChatRow = { id: string; title: string; updated_at: string; pinned: boolean; kind?: string };

export function ChatSidebar({ onClose, focusSearchToken }: { onClose?: () => void; focusSearchToken?: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // One dialog for the whole list rather than one per row.
  const [deleteTarget, setDeleteTarget] = useState<ChatRow | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  // Reclaims the quota held by the retired write-only response cache. Cheap
  // enough to do on mount, and it runs once per session because the key is gone
  // afterwards.
  useEffect(() => { purgeLegacyResponseCache(); }, []);

  /*
   * ⌘/Ctrl+K arrives as a bumped counter from the shell rather than a ref handed
   * upward, because two of these sidebars exist (desktop column and mobile
   * drawer) and a shared ref would leave whichever mounted last owning the
   * focus. Comparing against the token seen on mount means mounting alone never
   * steals focus — which matters on the drawer, where an unexpected focus pops
   * the on-screen keyboard.
   */
  const searchRef = useRef<HTMLInputElement>(null);
  const seenFocusToken = useRef(focusSearchToken ?? 0);
  useEffect(() => {
    const token = focusSearchToken ?? 0;
    if (token === seenFocusToken.current) return;
    seenFocusToken.current = token;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [focusSearchToken]);

  const chatsQ = useQuery({
    queryKey: ["chats"],
    queryFn: async (): Promise<ChatRow[]> => {
      const { data, error } = await supabase
        .from("chats")
        .select("id, title, updated_at, pinned, kind")
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChatRow[];
    },
    // The sidebar only changes when this app changes it, and every one of those
    // paths already invalidates this key. Without a staleTime the list refetched
    // on every window focus and every route change, competing with the in-flight
    // AI request for the connection.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const profileQ = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name, username, email, plan, avatar_url").maybeSingle();
      return data;
    },
    // Name/plan/avatar effectively never change mid-session.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const checkAdmin = useServerFn(isAdminFn);
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => checkAdmin(), staleTime: 60_000 });

  const renameFn = useServerFn(renameChat);
  const deleteFn = useServerFn(deleteChat);
  const pinFn = useServerFn(togglePinChat);

  const renameM = useMutation({
    mutationFn: (v: { chatId: string; title: string }) => renameFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chats"] }),
    onError: () => toast.error("Couldn't rename that chat"),
  });
  const deleteM = useMutation({
    mutationFn: (chatId: string) => deleteFn({ data: { chatId } }),
    onSuccess: (_, chatId) => {
      qc.invalidateQueries({ queryKey: ["chats"] });
      if (pathname.includes(chatId)) navigate({ to: "/chat" });
      toast.success("Chat deleted");
    },
    onError: () => toast.error("Couldn't delete that chat"),
  });
  const pinM = useMutation({
    mutationFn: (v: { chatId: string; pinned: boolean }) => pinFn({ data: v }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["chats"] });
      toast.success(v.pinned ? "Pinned" : "Unpinned");
    },
    onError: () => toast.error("Couldn't update that chat"),
  });

  const q = search.trim().toLowerCase();
  const filtered = (chatsQ.data ?? []).filter((c) => c.title.toLowerCase().includes(q));

  /*
   * Export builds the file in the browser from the chat's own rows, read through
   * the user's row-level-security policy — no new endpoint, and the conversation
   * never leaves the device.
   *
   * Messages are fetched when the menu item is clicked rather than joined into the
   * sidebar query: the list needs titles only, and pulling every message of every
   * chat to populate a menu nobody opened would undo the Stage 3 payload work.
   */
  const exportConversation = async (chat: ChatRow, format: "md" | "json") => {
    if (exportingId) return;
    setExportingId(chat.id);
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("role, content, created_at")
        .eq("chat_id", chat.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const messages = (data ?? []) as ExportMessage[];
      if (messages.length === 0) {
        toast.message("Nothing to export yet — this chat is empty.");
        return;
      }
      downloadConversation(chat.title, messages, format);
    } catch {
      toast.error("Couldn't export that chat");
    } finally {
      setExportingId(null);
    }
  };

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    // The query cache is in memory; drafts and prefs are not. Clear both so the
    // next account on this browser starts empty.
    clearLocalUserData();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const commitRename = (c: ChatRow) => {
    const next = renameValue.trim();
    if (next && next !== c.title) renameM.mutate({ chatId: c.id, title: next });
    setRenamingId(null);
  };

  const navItem =
    "w-full justify-start gap-2.5 border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

  return (
    <aside className="chat-sidebar flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <Link
          to="/chat"
          className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 font-display text-[15px] font-semibold"
          onClick={onClose}
        >
          {/* The ꯃ mark renders from --font-sans, which now carries Noto Sans
              Meetei Mayek as a fallback — it used to be a tofu box on Apple
              devices, which ships no Meetei Mayek face. */}
          <span
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-base font-semibold leading-none text-primary-foreground"
            aria-hidden="true"
          >
            ꯃ
          </span>
          <span className="truncate">Manipuri AI</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">v1.1</span>
        </Link>
        {/*
          Collapse used to reach into the DOM with getElementById and set
          data-state / strip a class — neither of which did anything, because the
          parent drives width and transform from React state and blew the class
          change away on the next render. It just calls onClose now.
        */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <PanelLeftClose className="h-[18px] w-[18px]" />
        </Button>
      </div>

      <div className="space-y-1.5 px-3">
        <Link to="/chat" onClick={onClose} className="block">
          <Button variant="outline" className={navItem}>
            <Plus className="h-4 w-4 text-gold" /> New chat
          </Button>
        </Link>
        <Link to="/image" onClick={onClose} className="block">
          <Button variant="outline" className={navItem}>
            <Sparkles className="h-4 w-4 text-gold" /> Create image
          </Button>
        </Link>
      </div>

      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-9 border-sidebar-border bg-sidebar-accent/50 pl-8 pr-8 text-sm placeholder:text-muted-foreground"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <nav aria-label="Conversations" className="mt-3 flex-1 overflow-y-auto px-2 pb-2">
        {chatsQ.isLoading && (
          // Three shimmering rows the same height as real ones, so the list does
          // not jump when it arrives. Was a bare "Loading…" string.
          <ul className="space-y-1 px-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-2 px-2 py-2">
                <span className="shimmer h-3.5 w-3.5 shrink-0 rounded" />
                <span className="shimmer h-3 flex-1 rounded" style={{ maxWidth: `${70 - i * 12}%` }} />
              </li>
            ))}
          </ul>
        )}
        {chatsQ.isError && (
          <div className="px-3 py-6 text-center text-xs">
            <p className="text-muted-foreground">Couldn't load your chats.</p>
            <Button variant="ghost" size="sm" className="mt-2 h-8 text-gold" onClick={() => chatsQ.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {chatsQ.data && filtered.length === 0 && (
          <div className="px-4 py-8 text-center">
            {q ? (
              <>
                <p className="text-sm text-foreground">No chats match "{search}"</p>
                <Button variant="ghost" size="sm" className="mt-2 h-8 text-gold" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              </>
            ) : (
              <>
                <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                <p className="mt-3 text-sm text-foreground">No chats yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Ask something in Manipuri or English to get started.</p>
              </>
            )}
          </div>
        )}
        {(() => {
          const pinned = filtered.filter((c) => c.pinned);
          const recent = filtered.filter((c) => !c.pinned);
          const renderRow = (c: ChatRow) => {
            const active = pathname === `/chat/${c.id}`;
            const isRenaming = renamingId === c.id;
            return (
              <li
                key={c.id}
                className={`group relative flex items-center gap-0.5 rounded-lg pr-1 ${
                  active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
                }`}
              >
                {/* A gold rail is the one unambiguous "you are here" marker. The
                    active row used to differ only by a slightly lighter grey. */}
                {active && (
                  <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-gold" />
                )}
                {isRenaming ? (
                  <form
                    className="flex-1 px-1.5 py-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      commitRename(c);
                    }}
                  >
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      // Blur commits rather than discards. It used to throw the
                      // edit away, so clicking anywhere lost the new title.
                      onBlur={() => commitRename(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setRenamingId(null);
                        }
                      }}
                      aria-label={`Rename ${c.title}`}
                      className="h-8 text-sm"
                    />
                  </form>
                ) : (
                  <Link
                    to="/chat/$chatId"
                    params={{ chatId: c.id }}
                    onClick={onClose}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2.5 text-sm ${
                      active ? "font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:text-sidebar-foreground"
                    }`}
                  >
                    {c.pinned ? (
                      <Pin className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden="true" />
                    ) : c.kind === "image" ? (
                      <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="truncate">{c.title}</span>
                  </Link>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    {/*
                      `focus-visible:opacity-100` and `data-[state=open]` are what
                      make this reachable: it was hover-only on desktop, so a
                      keyboard user could tab to an invisible button and a
                      touch-hover device could never reveal it.
                    */}
                    <button
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      aria-label={`Options for ${c.title}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => pinM.mutate({ chatId: c.id, pinned: !c.pinned })}>
                      {c.pinned ? <><PinOff className="mr-2 h-3.5 w-3.5" /> Unpin</> : <><Pin className="mr-2 h-3.5 w-3.5" /> Pin</>}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setRenamingId(c.id); setRenameValue(c.title); }}>
                      <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Download className="mr-2 h-3.5 w-3.5" /> Export
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {/* Markdown for reading and sharing; JSON for keeping
                            your own copy of the data. */}
                        <DropdownMenuItem onClick={() => void exportConversation(c, "md")}>
                          <FileText className="mr-2 h-3.5 w-3.5" /> Markdown
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void exportConversation(c, "json")}>
                          <FileJson className="mr-2 h-3.5 w-3.5" /> JSON
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(c)}>
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
                  {/* Sentence case, no letter-spacing. The tracked-out ALL-CAPS
                      eyebrow is template chrome, not information. */}
                  <h2 className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">Pinned</h2>
                  <ul className="space-y-0.5">{pinned.map(renderRow)}</ul>
                </>
              )}
              {recent.length > 0 && (
                <>
                  <h2 className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
                    {pinned.length > 0 ? "Recent" : "Chats"}
                  </h2>
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
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-sidebar-accent">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {(profileQ.data?.full_name ?? profileQ.data?.username ?? profileQ.data?.email ?? "U").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{profileQ.data?.full_name ?? profileQ.data?.username ?? "Account"}</div>
                {(() => {
                  const p = profileQ.data?.plan ?? "free";
                  const premium = p === "pro" || p === "max";
                  return (
                    <div
                      className={`truncate text-xs capitalize ${premium ? "font-semibold" : "text-muted-foreground"}`}
                      style={premium ? { background: "linear-gradient(90deg,#f5d67a,#c9a84c,#f0d78c)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" } : undefined}
                    >
                      {p} plan
                    </div>
                  );
                })()}
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild><Link to="/dashboard"><LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard</Link></DropdownMenuItem>
            {/* `is-admin` was already being queried and then never read, so every
                user saw an Admin panel link they could not use. */}
            {adminQ.data && (
              <DropdownMenuItem asChild><Link to="/admin"><Shield className="mr-2 h-4 w-4" /> Admin panel</Link></DropdownMenuItem>
            )}
            <DropdownMenuItem asChild><Link to="/profile"><User className="mr-2 h-4 w-4" /> Profile</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to="/plans"><CreditCard className="mr-2 h-4 w-4" /> Plans & billing</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/*
        Replaces `confirm("Delete this chat?")`. A native confirm is unstyled,
        unthemeable, blocks the whole tab, is suppressible by the browser, and
        never said which chat was about to go.
      */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" and all of its messages will be removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep chat</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) deleteM.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

export function AuthedShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarState, setSidebarState] = useState<'open' | 'closed'>('open');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focusSearchToken, setFocusSearchToken] = useState(0);
  const shellNavigate = useNavigate();

  // Track last-login. This used to fire an unconditional UPDATE on every mount,
  // so a full page load spent a write round-trip before the sidebar and the
  // chat's own queries got the connection. Now it is throttled to once every six
  // hours and deferred until the browser is idle — the column is only ever read
  // as a coarse "when was this user last around", so the precision is unchanged.
  useEffect(() => {
    const KEY = "mni:last-login-write";
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY)) || 0;
    } catch { /* private mode */ }
    if (Date.now() - last < SIX_HOURS) return;

    const write = () => {
      try {
        localStorage.setItem(KEY, String(Date.now()));
      } catch { /* private mode */ }
      void supabase
        .from("profiles")
        .update({ last_login_at: new Date().toISOString() })
        .then(() => {});
    };

    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (idle) {
      const handle = idle(write, { timeout: 4000 });
      return () => {
        (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle);
      };
    }
    const t = setTimeout(write, 2000);
    return () => clearTimeout(t);
  }, []);

  // Escape closes the mobile drawer — the standard exit for a modal overlay,
  // which previously had none.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  /*
   * App-wide shortcuts. Documented in ShortcutsDialog, which renders from the
   * same list these are written against.
   *
   * Search focus is only requested on desktop: on a phone the sidebar is a modal
   * drawer that has to mount first, and focusing a field there raises the
   * keyboard over the list the user just asked to see. Opening the drawer is the
   * useful half of the shortcut on that size.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hasMod(e) || e.altKey) return;
      const key = e.key.toLowerCase();
      const wide = window.innerWidth >= 768;

      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        if (wide) {
          setSidebarState("open");
          setFocusSearchToken((n) => n + 1);
        } else {
          setMobileOpen(true);
        }
        return;
      }
      if (key === "o" && e.shiftKey) {
        e.preventDefault();
        setMobileOpen(false);
        void shellNavigate({ to: "/chat" });
        return;
      }
      if (key === "b" && !e.shiftKey) {
        e.preventDefault();
        if (wide) setSidebarState((prev) => (prev === "open" ? "closed" : "open"));
        else setMobileOpen((prev) => !prev);
        return;
      }
      if (key === "/") {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shellNavigate]);

  /*
   * Swipe-to-close for the mobile drawer.
   *
   * Deliberately gated on horizontal intent: the gesture only takes over once
   * the finger has moved 12px and horizontal travel beats vertical by 1.5x. If
   * the first meaningful movement is vertical, the gesture is locked out for the
   * rest of the touch so the chat list scrolls normally. Nothing calls
   * preventDefault, so native scrolling is never suppressed.
   *
   * Edge-swipe-to-open is not implemented on purpose: the left screen edge is
   * owned by iOS Safari's back-navigation gesture, and competing with it makes
   * both unreliable. The header button opens the drawer.
   */
  const touch = useRef<{ x: number; y: number; axis: "none" | "x" | "y" } | null>(null);
  const [dragX, setDragX] = useState(0);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, axis: "none" };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = touch.current;
    if (!s || s.axis === "y") return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (s.axis === "none") {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      s.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";
      if (s.axis === "y") return;
    }
    setDragX(Math.min(0, dx)); // rightward drag does nothing; it is already open
  };
  const onTouchEnd = () => {
    const s = touch.current;
    touch.current = null;
    if (s?.axis === "x" && dragX < -60) setMobileOpen(false);
    setDragX(0);
  };

  const dragging = dragX !== 0;
  // On desktop with the sidebar open the header held nothing but a duplicate of
  // the brand already shown in the sidebar, so it is hidden there and the chat
  // gets the full column height.
  const headerHidden = sidebarState === "open";

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      <div
        className="hidden h-full overflow-hidden border-r border-sidebar-border transition-[width,opacity,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[width,opacity,transform] md:block"
        style={{
          width: sidebarState === 'open' ? '18rem' : '0',
          opacity: sidebarState === 'open' ? 1 : 0,
          transform: sidebarState === 'open' ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        <ChatSidebar onClose={() => setSidebarState('closed')} focusSearchToken={focusSearchToken} />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          />
          <div
            className={`absolute inset-y-0 left-0 shadow-glow ${dragging ? "" : "animate-in slide-in-from-left duration-300"}`}
            style={dragging ? { transform: `translateX(${dragX}px)` } : undefined}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <ChatSidebar onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="relative flex min-w-0 flex-1 flex-col bg-background">
        <header
          className={`sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/70 ${
            headerHidden ? "md:hidden" : ""
          }`}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (window.innerWidth < 768) setMobileOpen(true);
              else setSidebarState((prev) => (prev === 'open' ? 'closed' : 'open'));
            }}
            aria-label="Open sidebar"
            title="Open sidebar"
            className="h-10 w-10 shrink-0 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <PanelLeftOpen className="h-[20px] w-[20px]" />
          </Button>

          <Link to="/chat" className="flex min-w-0 flex-1 items-center justify-center gap-1.5 md:justify-start">
            <span className="truncate font-display text-base font-semibold tracking-tight">Manipuri AI</span>
            <span className="shrink-0 rounded-full border border-gold/25 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
              v1.1
            </span>
          </Link>

          <Link to="/chat" className="shrink-0 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label="New chat"
              title="New chat"
              className="h-10 w-10 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-[20px] w-[20px]" />
            </Button>
          </Link>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
