import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Intentionally NOT using requireSupabaseAuth: this is called from the shell on
// every page (including right after sign-out), where no bearer token exists.
// Missing/invalid session simply means "not an admin", never a thrown 500.
export const isAdmin = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const authHeader = request?.headers?.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return { isAdmin: false };
    const token = authHeader.slice(7);
    if (token.split(".").length !== 3) return { isAdmin: false };

    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return { isAdmin: false };

    const client = createClient(url, key, {
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
            headers.delete("Authorization");
          }
          headers.set("apikey", key);
          headers.set("Authorization", `Bearer ${token}`);
          return fetch(input, { ...init, headers });
        },
      },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data: claims } = await client.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (!userId) return { isAdmin: false };

    const { data, error } = await client
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    return { isAdmin: !error && Boolean(data) };
  } catch {
    return { isAdmin: false };
  }
});

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin } = await import("./admin.server");
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
    const { assertAdmin } = await import("./admin.server");
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = Math.min(data?.limit ?? 100, 500);
    // Downgrade any paid plans whose validity has ended before listing.
    await supabaseAdmin.rpc("expire_due_subscriptions");

    let q = supabaseAdmin
      .from("profiles")
      .select("id, email, username, full_name, age, plan, subscription_status, subscription_start, subscription_end, preferred_language, last_login_at, created_at, avatar_url")
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

    const [{ data: roles }, { data: chatCounts }, { data: msgCounts }, { data: paidRows }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
      supabaseAdmin.from("chats").select("user_id").in("user_id", ids),
      supabaseAdmin.from("messages").select("user_id").in("user_id", ids),
      supabaseAdmin
        .from("payments")
        .select("user_id, updated_at")
        .eq("status", "paid")
        .in("user_id", ids)
        .order("updated_at", { ascending: true }),
    ]);

    // Validity derived from paid payments (each payment = 1 month; an early
    // renewal extends from the current end). Used for users upgraded before
    // the subscription window was stored on the profile.
    const paidEnd = new Map<string, Date>();
    for (const p of paidRows ?? []) {
      const paidAt = new Date(p.updated_at);
      const cur = paidEnd.get(p.user_id);
      const start = cur && cur > paidAt ? cur : paidAt;
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      paidEnd.set(p.user_id, end);
    }

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
        subscription_end: u.subscription_end ?? (u.plan !== "free" ? paidEnd.get(u.id)?.toISOString() ?? null : null),
        roles: roleMap.get(u.id) ?? [],
        chatCount: chatCount.get(u.id) ?? 0,
        messageCount: msgCount.get(u.id) ?? 0,
      })),
    };
  });

export const listAdminCorrections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin } = await import("./admin.server");
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
    const { assertAdmin } = await import("./admin.server");
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
    const { assertAdmin } = await import("./admin.server");
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
    const { assertAdmin } = await import("./admin.server");
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

// Aggregate Gemini usage for the admin dashboard. Rows contain no message
// content — only model/mode/token counters — and the table is service-role
// only, so this admin-gated read is the sole way in.
export const getGeminiUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin } = await import("./admin.server");
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data, error } = await supabaseAdmin
      .from("gemini_usage")
      .select("model, mode, source, purpose, input_tokens, output_tokens, thinking_tokens, total_tokens, api_calls, cost_estimate_inr, success, is_guest, created_at")
      .gte("created_at", since30)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const since7 = Date.now() - 7 * 864e5;

    type Bucket = {
      calls: number;
      input: number;
      output: number;
      thinking: number;
      total: number;
      costInr: number;
      failures: number;
    };
    const blank = (): Bucket => ({ calls: 0, input: 0, output: 0, thinking: 0, total: 0, costInr: 0, failures: 0 });
    const add = (b: Bucket, r: (typeof rows)[number]) => {
      b.calls += r.api_calls ?? 1;
      b.input += r.input_tokens ?? 0;
      b.output += r.output_tokens ?? 0;
      b.thinking += r.thinking_tokens ?? 0;
      b.total += r.total_tokens ?? 0;
      b.costInr += Number(r.cost_estimate_inr ?? 0);
      if (!r.success) b.failures += 1;
    };

    const totals = { today: blank(), last7d: blank(), last30d: blank() };
    const byModel = new Map<string, Bucket>();
    const byPurpose = new Map<string, Bucket>();

    for (const r of rows) {
      add(totals.last30d, r);
      if (r.created_at.slice(0, 10) === today) add(totals.today, r);
      if (new Date(r.created_at).getTime() >= since7) add(totals.last7d, r);
      const mk = `${r.model} (${r.mode})`;
      if (!byModel.has(mk)) byModel.set(mk, blank());
      add(byModel.get(mk)!, r);
      const pk = r.purpose;
      if (!byPurpose.has(pk)) byPurpose.set(pk, blank());
      add(byPurpose.get(pk)!, r);
    }

    const toRows = (m: Map<string, Bucket>) =>
      [...m.entries()]
        .map(([key, b]) => ({ key, ...b, costInr: Math.round(b.costInr * 100) / 100 }))
        .sort((a, b) => b.costInr - a.costInr);
    const roundBucket = (b: Bucket) => ({ ...b, costInr: Math.round(b.costInr * 100) / 100 });

    return {
      totals: { today: roundBucket(totals.today), last7d: roundBucket(totals.last7d), last30d: roundBucket(totals.last30d) },
      byModel: toRows(byModel),
      byPurpose: toRows(byPurpose),
    };
  });

export const listMcpServers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin } = await import("./admin.server");
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
    const { assertAdmin } = await import("./admin.server");
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
    const { assertAdmin } = await import("./admin.server");
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
    const { assertAdmin } = await import("./admin.server");
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("mcp_servers")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });
