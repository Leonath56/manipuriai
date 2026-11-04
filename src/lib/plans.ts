export type Plan = "free" | "pro" | "max";

export const PLAN_LIMITS: Record<Plan, { dailyMessages: number; label: string; price: string; priceInPaise: number; model: string; features: string[] }> = {
  free: {
    label: "Free",
    price: "₹0",
    priceInPaise: 0,
    dailyMessages: 8,
    model: "google/gemini-2.5-flash",
    features: [
      "8 AI messages per day",
      "Bilingual Manipuri & English",
      "Basic chat history",
      "Markdown & code blocks",
    ],
  },
  pro: {
    label: "Pro",
    price: "₹99",
    priceInPaise: 9900,
    dailyMessages: 100,
    model: "google/gemini-2.5-flash",
    features: [
      "100 messages per day",
      "Faster responses",
      "Voice mode",
      "AI image generation",
      "Priority processing",
    ],
  },
  max: {
    label: "Max",
    price: "₹399",
    priceInPaise: 39900,
    dailyMessages: 200,
    model: "google/gemini-2.5-pro",
    features: [
      "200 messages per day",
      "Deep Think mode (advanced reasoning)",
      "Fastest responses",
      "Premium AI model",
      "Voice mode & AI images",
      "Unlimited chat history",
      "Early access to new features",
    ],
  },
};

/**
 * Today's date in Asia/Kolkata (YYYY-MM-DD). Daily message limits reset at
 * midnight Indian Standard Time, not midnight UTC — a UTC date would roll
 * over at 5:30 AM IST and hand everyone a fresh allowance mid-morning.
 */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

/**
 * Subscription window after a verified payment.
 *
 * - Same-plan renewal of a still-active plan extends from the current end
 *   date, so paying early never shortens the paid period.
 * - A plan *change* (Free→Pro, Pro→Max, Max→Pro, or renewing after expiry)
 *   starts a fresh one-month window from the payment timestamp. The old
 *   plan's remaining days are NOT carried forward — carrying them over was
 *   the upgrade bug that turned a 30-day Max into ~60 days.
 */
export function computeSubscriptionEnd(opts: {
  now: Date;
  currentPlan?: Plan | null;
  currentEnd?: string | null;
  newPlan: Plan;
}): Date {
  const currentEnd = opts.currentEnd ? new Date(opts.currentEnd) : null;
  const samePlanRenewal =
    opts.currentPlan === opts.newPlan &&
    opts.currentPlan !== "free" &&
    currentEnd !== null &&
    currentEnd > opts.now;
  const base = samePlanRenewal && currentEnd ? currentEnd : opts.now;
  const end = new Date(base);
  end.setMonth(end.getMonth() + 1);
  return end;
}
