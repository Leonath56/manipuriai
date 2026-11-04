import test from "node:test";
import assert from "node:assert/strict";
import { computeSubscriptionEnd, todayIst, PLAN_LIMITS } from "../src/lib/plans.ts";

const now = new Date("2026-11-04T13:44:12.027Z");

test("first-time purchase starts a one-month window from payment", () => {
  const end = computeSubscriptionEnd({ now, currentPlan: "free", currentEnd: null, newPlan: "pro" });
  assert.equal(end.toISOString(), "2026-12-04T13:44:12.027Z");
});

test("Pro → Max upgrade replaces Pro: remaining Pro days are NOT carried forward", () => {
  // Pro bought Oct 24 (ends Nov 24), Max bought Nov 4 → Max ends Dec 4, not later.
  const end = computeSubscriptionEnd({
    now,
    currentPlan: "pro",
    currentEnd: "2026-11-24T13:44:12.027Z",
    newPlan: "max",
  });
  assert.equal(end.toISOString(), "2026-12-04T13:44:12.027Z");
});

test("upgrade with 1 day remaining still starts fresh from payment", () => {
  const end = computeSubscriptionEnd({
    now,
    currentPlan: "pro",
    currentEnd: "2026-11-05T13:44:12.027Z",
    newPlan: "max",
  });
  assert.equal(end.toISOString(), "2026-12-04T13:44:12.027Z");
});

test("same-plan renewal of an active plan extends from the current end", () => {
  const end = computeSubscriptionEnd({
    now,
    currentPlan: "max",
    currentEnd: "2026-11-20T13:44:12.027Z",
    newPlan: "max",
  });
  assert.equal(end.toISOString(), "2026-12-20T13:44:12.027Z");
});

test("renewal after expiry starts fresh from payment, not from the old end", () => {
  const end = computeSubscriptionEnd({
    now,
    currentPlan: "pro",
    currentEnd: "2026-10-01T13:44:12.027Z",
    newPlan: "pro",
  });
  assert.equal(end.toISOString(), "2026-12-04T13:44:12.027Z");
});

test("plan change Max → Pro also starts a fresh window", () => {
  const end = computeSubscriptionEnd({
    now,
    currentPlan: "max",
    currentEnd: "2026-11-24T13:44:12.027Z",
    newPlan: "pro",
  });
  assert.equal(end.toISOString(), "2026-12-04T13:44:12.027Z");
});

test("todayIst rolls over at midnight IST, not UTC", () => {
  // 2026-11-04 18:30 UTC = 2026-11-05 00:00 IST
  assert.equal(todayIst(new Date("2026-11-04T18:30:00Z")), "2026-11-05");
  // 2026-11-04 18:29 UTC = 2026-11-04 23:59 IST
  assert.equal(todayIst(new Date("2026-11-04T18:29:00Z")), "2026-11-04");
});

test("Free allows 8 messages per day, Pro allows 100", () => {
  assert.equal(PLAN_LIMITS.free.dailyMessages, 8);
  assert.equal(PLAN_LIMITS.pro.dailyMessages, 100);
});

test("Max allows 200 messages per IST day", () => {
  assert.equal(PLAN_LIMITS.max.dailyMessages, 200);
});
