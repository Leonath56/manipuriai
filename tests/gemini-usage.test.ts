import { describe, expect, it } from "vitest";
import {
  estimateCostInr,
  extractStreamUsage,
  extractUsage,
  shouldRefreshSummary,
  SUMMARY_MIN_NEW_MESSAGES,
  SUMMARY_MIN_TOTAL_MESSAGES,
} from "../src/lib/gemini-usage.server";

describe("estimateCostInr", () => {
  it("prices input and output tokens separately per model", () => {
    // gemini-3.8-flash: ₹25/1M input, ₹150/1M output
    expect(estimateCostInr("gemini-3.8-flash", 1_000_000, 0)).toBe(25);
    expect(estimateCostInr("gemini-3.8-flash", 0, 1_000_000)).toBe(150);
  });

  it("bills thinking tokens as output tokens", () => {
    const withThinking = estimateCostInr("gemini-3.1-pro-preview", 0, 500_000, 500_000);
    const withoutThinking = estimateCostInr("gemini-3.1-pro-preview", 0, 1_000_000, 0);
    expect(withThinking).toBe(withoutThinking);
  });

  it("falls back to flash-tier pricing for unknown models", () => {
    expect(estimateCostInr("some-future-model", 1_000_000, 1_000_000)).toBe(175);
  });

  it("returns 0 for empty usage", () => {
    expect(estimateCostInr("gemini-3.8-flash", 0, 0, 0)).toBe(0);
  });
});

describe("extractUsage / extractStreamUsage", () => {
  it("reads usage metadata from a response body", () => {
    const body = {
      choices: [],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 40,
        total_tokens: 160,
        completion_tokens_details: { reasoning_tokens: 12 },
      },
    };
    expect(extractUsage(body)).toEqual(body.usage);
    expect(extractStreamUsage(body)).toEqual(body.usage);
  });

  it("returns null when no usage is present", () => {
    expect(extractUsage({ choices: [] })).toBeNull();
    expect(extractStreamUsage(null)).toBeNull();
    expect(extractUsage(undefined)).toBeNull();
  });
});

describe("shouldRefreshSummary", () => {
  it("never summarizes short conversations", () => {
    expect(shouldRefreshSummary(SUMMARY_MIN_TOTAL_MESSAGES - 1, 0, false)).toBe(false);
  });

  it("summarizes a long conversation that has no summary yet", () => {
    expect(shouldRefreshSummary(SUMMARY_MIN_TOTAL_MESSAGES, 0, false)).toBe(true);
  });

  it("does not regenerate a summary on every message", () => {
    // Long chat, summary exists, only 2 new messages since it was written.
    expect(shouldRefreshSummary(40, 38, true)).toBe(false);
  });

  it("refreshes once enough new messages have arrived", () => {
    expect(shouldRefreshSummary(40, 40 - SUMMARY_MIN_NEW_MESSAGES, true)).toBe(true);
  });
});
