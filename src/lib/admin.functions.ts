import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "./admin.server";

export const isAdmin = createServerFn({ method: "GET" })
  .handler(async () => {
    // Don't use requireSupabaseAuth: this fn is polled from the shell and
    // may fire during logout when the bearer is already gone. Return
    // { isAdmin: false } instead of throwing 401 (which blank-screens).
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const authHeader = req?.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return { isAdmin: false };
    const token = authHeader.slice("Bearer ".length);
    if (token.split(".").length !== 3) return { isAdmin: false };

    const { createClient } = await import("@supabase/supabase-js");
    const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });
    const { data: claimsRes } = await supa.auth.getClaims(token);
    const userId = claimsRes?.claims?.sub;
    if (!userId) return { isAdmin: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const today = new Date().toISOString().slice(0, 10);
    const since7 = new Date(Date.now() - 7 * 864e5).toISOString();

    const [profiles, chats, messages, msgs7, usageToday, corrections] = await Promise.all([
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("chats").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("messages").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("messages").select("*", { count: "exact", head: true }).gte("created_at", since7),
      supabaseAdmin.from("daily_usage").select("message_count").eq("usage_date", today),
      supabaseAdmin.from("manipuri_corrections").select("*", { count: "exact", head: true }),
    ]);

    const messagesToday = (usageToday.data ?? []).reduce((a, r) => a + (r.message_count ?? 0), 0);

    // Plan breakdown
    const { data: planRows } = await supabaseAdmin.from("profiles").select("plan");
    const planCounts: Record<string, number> = {};
    for (const r of planRows ?? []) planCounts[r.plan] = (planCounts[r.plan] ?? 0) + 1;

    return {
      totalUsers: profiles.count ?? 0,
      totalChats: chats.count ?? 0,
      totalMessages: messages.count ?? 0,
      messagesLast7d: msgs7.count ?? 0,
      messagesToday,
      totalCorrections: corrections.count ?? 0,
      planCounts,
    };
  });

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string; limit?: number } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = Math.min(data.limit ?? 100, 500);

    let q = supabaseAdmin
      .from("profiles")
      .select("id, email, username, full_name, age, plan, preferred_language, last_login_at, created_at, avatar_url")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data.search) {
      const s = `%${data.search}%`;
      q = q.or(`email.ilike.${s},username.ilike.${s},full_name.ilike.${s}`);
    }
    const { data: users, error } = await q;
    if (error) throw new Error(error.message);

    const ids = (users ?? []).map((u) => u.id);
    if (ids.length === 0) return { users: [] };

    const [{ data: roles }, { data: chatCounts }, { data: msgCounts }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
      supabaseAdmin.from("chats").select("user_id").in("user_id", ids),
      supabaseAdmin.from("messages").select("user_id").in("user_id", ids),
    ]);

    const roleMap = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    }
    const chatCount = new Map<string, number>();
    for (const c of chatCounts ?? []) chatCount.set(c.user_id, (chatCount.get(c.user_id) ?? 0) + 1);
    const msgCount = new Map<string, number>();
    for (const m of msgCounts ?? []) msgCount.set(m.user_id, (msgCount.get(m.user_id) ?? 0) + 1);

    return {
      users: (users ?? []).map((u) => ({
        ...u,
        roles: roleMap.get(u.id) ?? [],
        chatCount: chatCount.get(u.id) ?? 0,
        messageCount: msgCount.get(u.id) ?? 0,
      })),
    };
  });

export const listAdminCorrections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("manipuri_corrections")
      .select("id, user_id, original_text, corrected_text, note, language, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { corrections: data ?? [] };
  });

export const getAdminUserConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profile }, { data: chats }, { data: messages }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, email, username, full_name")
        .eq("id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("chats")
        .select("id, title, created_at, updated_at")
        .eq("user_id", data.userId)
        .order("updated_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("messages")
        .select("id, chat_id, role, content, created_at")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: true })
        .limit(2000),
    ]);

    return {
      profile: profile ?? null,
      chats: chats ?? [],
      messages: messages ?? [],
    };
  });

export const listGuestTrialSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("guest_sessions")
      .select("id, guest_id, name, message_count, user_agent, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { sessions: data ?? [] };
  });

export const getGuestTrialMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: session }, { data: messages }] = await Promise.all([
      supabaseAdmin
        .from("guest_sessions")
        .select("id, guest_id, name, message_count, user_agent, created_at, updated_at")
        .eq("id", data.sessionId)
        .maybeSingle(),
      supabaseAdmin
        .from("guest_messages")
        .select("id, role, content, created_at")
        .eq("guest_session_id", data.sessionId)
        .order("created_at", { ascending: true })
        .limit(500),
    ]);
    return { session: session ?? null, messages: messages ?? [] };
  });
