import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PLAN_LIMITS, todayIst, type Plan } from "./plans";

export type SubscriptionStatus = {
  plan: "free" | "pro" | "max";
  status: "free" | "active" | "expired";
  start: string | null;
  end: string | null;
  imageCredits: { used: number; limit: number; remaining: number };
  /** Today's chat usage against the plan's daily limit (resets midnight IST). */
  dailyMessages: { used: number; limit: number; remaining: number };
};

export const IMAGE_CREDIT_LIMIT = 3;

/**
 * Server-side subscription + image-credit snapshot for the signed-in user.
 * Resolving through get_effective_plan means an expired subscription is
 * downgraded here, on the server, before the client ever renders a plan name.
 */
export const getSubscriptionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubscriptionStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: effective } = await supabaseAdmin.rpc("get_effective_plan", {
      _user_id: context.userId,
    });
    const row = Array.isArray(effective) ? effective[0] : effective;

    const plan = (row?.plan as SubscriptionStatus["plan"] | undefined) ?? "free";
    const status =
      (row?.subscription_status as SubscriptionStatus["status"] | undefined) ??
      (plan === "free" ? "free" : "active");

    let used = 0;
    if (plan !== "free") {
      const periodStart = row?.subscription_start
        ? String(row.subscription_start).slice(0, 10)
        : null;
      let q = supabaseAdmin
        .from("image_usage")
        .select("used, period_start")
        .eq("user_id", context.userId)
        .maybeSingle();
      const { data: usage } = await q;
      if (usage && (!periodStart || usage.period_start >= periodStart)) {
        used = usage.used;
      }
    }

    const { data: usageRow } = await supabaseAdmin
      .from("daily_usage")
      .select("message_count")
      .eq("user_id", context.userId)
      .eq("usage_date", todayIst())
      .maybeSingle();
    const messagesUsed = usageRow?.message_count ?? 0;
    const messageLimit = PLAN_LIMITS[plan as Plan].dailyMessages;

    return {
      plan,
      status,
      start: row?.subscription_start ?? null,
      end: row?.subscription_end ?? null,
      imageCredits: {
        used,
        limit: IMAGE_CREDIT_LIMIT,
        remaining: Math.max(IMAGE_CREDIT_LIMIT - used, 0),
      },
      dailyMessages: {
        used: messagesUsed,
        limit: messageLimit,
        remaining: Math.max(messageLimit - messagesUsed, 0),
      },
    };
  });
