import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateCostInr,
  extractStreamUsage,
  extractUsage,
  shouldRefreshSummary,
  SUMMARY_MIN_NEW_MESSAGES,
  SUMMARY_MIN_TOTAL_MESSAGES,
} from "../src/lib/gemini-usage.server.ts";

test("estimateCostInr prices input and output tokens separately per model", () => {
  // gemini-3.8-flash: ₹25/1M input, ₹150/1M output
  assert.equal(estimateCostInr("gemini-3.8-flash", 1_000_000, 0), 25);
  assert.equal(estimateCostInr("gemini-3.8-flash", 0, 1_000_000), 150);
});

test("estimateCostInr bills thinking tokens as output tokens", () => {
  const withThinking = estimateCostInr("gemini-3.1-pro-preview", 0, 500_000, 500_000);
  const withoutThinking = estimateCostInr("gemini-3.1-pro-preview", 0, 1_000_000, 0);
  assert.equal(withThinking, withoutThinking);
});

test("estimateCostInr falls back to flash-tier pricing for unknown models", () => {
  assert.equal(estimateCostInr("some-future-model", 1_000_000, 1_000_000), 175);
});

test("estimateCostInr returns 0 for empty usage", () => {
  assert.equal(estimateCostInr("gemini-3.8-flash", 0, 0, 0), 0);
});

test("extractUsage reads usage metadata from a response body", () => {
  const body = {
    choices: [],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 40,
      total_tokens: 160,
      completion_tokens_details: { reasoning_tokens: 12 },
    },
  };
  assert.deepEqual(extractUsage(body), body.usage);
  assert.deepEqual(extractStreamUsage(body), body.usage);
});

test("extractUsage returns null when no usage is present", () => {
  assert.equal(extractUsage({ choices: [] }), null);
  assert.equal(extractStreamUsage(null), null);
  assert.equal(extractUsage(undefined), null);
});

test("shouldRefreshSummary never summarizes short conversations", () => {
  assert.equal(shouldRefreshSummary(SUMMARY_MIN_TOTAL_MESSAGES - 1, 0, false), false);
});

test("shouldRefreshSummary summarizes a long conversation with no summary yet", () => {
  assert.equal(shouldRefreshSummary(SUMMARY_MIN_TOTAL_MESSAGES, 0, false), true);
});

test("shouldRefreshSummary does not regenerate a summary on every message", () => {
  // Long chat, summary exists, only 2 new messages since it was written.
  assert.equal(shouldRefreshSummary(40, 38, true), false);
});

test("shouldRefreshSummary refreshes once enough new messages have arrived", () => {
  assert.equal(shouldRefreshSummary(40, 40 - SUMMARY_MIN_NEW_MESSAGES, true), true);
});
