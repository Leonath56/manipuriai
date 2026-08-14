import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "./admin.server";
import { z } from "zod";

export const isAdmin = createServerFn({ method: "GET" })
  .handler(async () => {
    // We try to use requireSupabaseAuth logic manually to avoid 401 throw on initial load/logout
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const authHeader = req?.headers.get("authorization") || req?.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return { isAdmin: false };
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token || token === "undefined" || token.split(".").length !== 3) return { isAdmin: false };

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supa = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '', process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '', {
        auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      });
      const { data: claimsRes } = await supa.auth.getClaims(token);
      const userId = claimsRes?.claims?.sub;
      if (!userId) return { isAdmin: false };

      // Use the RPC has_role for better security and consistency
      const { data: hasRole } = await supa.rpc("has_role", { _user_id: userId, _role: "admin" });
      return { isAdmin: !!hasRole };
    } catch (e) {
      console.error("isAdmin check failed:", e);
      return { isAdmin: false };
    }
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

    let creditsRemaining: number | undefined;
    try {
      const { getCreditStatus } = await import("./credits.functions");
      const status = await getCreditStatus();
      creditsRemaining = status.totalRemaining;
    } catch (e) {
      console.error("Failed to fetch credits:", e);
    }

    return {
      totalUsers: profiles.count ?? 0,
      totalChats: chats.count ?? 0,
      totalMessages: messages.count ?? 0,
      messagesLast7d: msgs7.count ?? 0,
      messagesToday,
      totalCorrections: corrections.count ?? 0,
      planCounts,
      creditsRemaining,
    };
  });

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ search: z.string().optional(), limit: z.number().optional() }).optional().parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = Math.min(data?.limit ?? 100, 500);

    let q = supabaseAdmin
      .from("profiles")
      .select("id, email, username, full_name, age, plan, preferred_language, last_login_at, created_at, avatar_url")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data?.search) {
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
  .inputValidator((d) => z.object({ userId: z.string() }).parse(d))
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
  .inputValidator((d) => z.object({ sessionId: z.string() }).parse(d))
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

export const listMcpServers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("mcp_servers")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { servers: data ?? [] };
  });

export const addMcpServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string(),
    url: z.string().url(),
    api_key: z.string().optional(),
    description: z.string().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: server, error } = await supabaseAdmin
      .from("mcp_servers")
      .insert({ ...data, user_id: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return server;
  });

export const toggleMcpServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string(), is_active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("mcp_servers")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const deleteMcpServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("mcp_servers")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });
