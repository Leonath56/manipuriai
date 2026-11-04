import { describe, expect, it } from "vitest";
import { computeSubscriptionEnd, todayIst, PLAN_LIMITS } from "@/lib/plans";

describe("computeSubscriptionEnd", () => {
  const now = new Date("2026-11-04T13:44:12.027Z");

  it("first-time purchase starts a one-month window from payment", () => {
    const end = computeSubscriptionEnd({ now, currentPlan: "free", currentEnd: null, newPlan: "pro" });
    expect(end.toISOString()).toBe("2026-12-04T13:44:12.027Z");
  });

  it("Pro → Max upgrade replaces Pro: remaining Pro days are NOT carried forward", () => {
    // Pro bought Oct 24 (ends Nov 24), Max bought Nov 4 → Max ends Dec 4, not Dec 24+.
    const proEnd = "2026-11-24T13:44:12.027Z";
    const end = computeSubscriptionEnd({ now, currentPlan: "pro", currentEnd: proEnd, newPlan: "max" });
    expect(end.toISOString()).toBe("2026-12-04T13:44:12.027Z");
  });

  it("upgrade with 1 day remaining still starts fresh from payment", () => {
    const proEnd = "2026-11-05T13:44:12.027Z";
    const end = computeSubscriptionEnd({ now, currentPlan: "pro", currentEnd: proEnd, newPlan: "max" });
    expect(end.toISOString()).toBe("2026-12-04T13:44:12.027Z");
  });

  it("same-plan renewal of an active plan extends from the current end", () => {
    const maxEnd = "2026-11-20T13:44:12.027Z";
    const end = computeSubscriptionEnd({ now, currentPlan: "max", currentEnd: maxEnd, newPlan: "max" });
    expect(end.toISOString()).toBe("2026-12-20T13:44:12.027Z");
  });

  it("renewal after expiry starts fresh from payment, not from the old end", () => {
    const expiredEnd = "2026-10-01T13:44:12.027Z";
    const end = computeSubscriptionEnd({ now, currentPlan: "pro", currentEnd: expiredEnd, newPlan: "pro" });
    expect(end.toISOString()).toBe("2026-12-04T13:44:12.027Z");
  });

  it("downgrade Max → Pro also starts a fresh window", () => {
    const maxEnd = "2026-11-24T13:44:12.027Z";
    const end = computeSubscriptionEnd({ now, currentPlan: "max", currentEnd: maxEnd, newPlan: "pro" });
    expect(end.toISOString()).toBe("2026-12-04T13:44:12.027Z");
  });
});

describe("todayIst", () => {
  it("rolls over at midnight IST, not UTC", () => {
    // 2026-11-04 18:30 UTC = 2026-11-05 00:00 IST
    expect(todayIst(new Date("2026-11-04T18:30:00Z"))).toBe("2026-11-05");
    // 2026-11-04 18:29 UTC = 2026-11-04 23:59 IST
    expect(todayIst(new Date("2026-11-04T18:29:00Z"))).toBe("2026-11-04");
  });
});

describe("plan limits", () => {
  it("Free allows 8 messages per day", () => {
    expect(PLAN_LIMITS.free.dailyMessages).toBe(8);
  });
  it("Pro allows 100 messages per day", () => {
    expect(PLAN_LIMITS.pro.dailyMessages).toBe(100);
  });
});
