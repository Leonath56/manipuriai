/**
 * Aggregate Gemini API usage tracking + cost estimation.
 *
 * Privacy rules (from the product brief):
 * - Never store API keys, prompts, or message content here.
 * - Rows are aggregate counters only: model, mode, token counts, cost estimate.
 * - Written and read only through the service role; the admin dashboard reads
 *   aggregates after a server-side admin check.
 *
 * Cost figures are ESTIMATES computed from the configurable price table below.
 * Update the table when Google changes pricing — nothing else needs to change.
 */

// Price per 1 MILLION tokens, in INR. Configurable on purpose: these are
// estimates, not billed amounts. Thinking tokens are billed as output tokens.
export const GEMINI_PRICING_INR_PER_1M: Record<string, { input: number; output: number }> = {
  "gemini-3.8-flash": { input: 25, output: 150 },
  "gemini-3.1-pro-preview": { input: 170, output: 1000 },
  "gemini-2.5-flash-lite": { input: 8, output: 32 },
  "gemini-2.5-flash": { input: 25, output: 200 },
  "gemini-2.5-pro": { input: 105, output: 840 },
  // Fallbacks for the `-latest` aliases used by legacy/voice paths.
  "gemini-flash-latest": { input: 25, output: 150 },
  "gemini-pro-latest": { input: 170, output: 1000 },
  "gemini-flash-lite-latest": { input: 8, output: 32 },
};

const FALLBACK_PRICING = { input: 25, output: 150 };

export function estimateCostInr(
  model: string,
  inputTokens: number,
  outputTokens: number,
  thinkingTokens = 0,
): number {
  const p = GEMINI_PRICING_INR_PER_1M[model] ?? FALLBACK_PRICING;
  const cost =
    (inputTokens / 1_000_000) * p.input + ((outputTokens + thinkingTokens) / 1_000_000) * p.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export type UsageMetadata = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
};

/** Pull usage metadata off a non-streaming chat completions response body. */
export function extractUsage(json: unknown): UsageMetadata | null {
  const u = (json as { usage?: UsageMetadata } | null)?.usage;
  return u && typeof u === "object" ? u : null;
}

/**
 * Pull usage metadata off one streaming SSE chunk. With
 * `stream_options: { include_usage: true }` the final chunk carries `usage`
 * and empty `choices`.
 */
export function extractStreamUsage(chunkJson: unknown): UsageMetadata | null {
  return extractUsage(chunkJson);
}

export type UsageLogEntry = {
  userId: string | null;
  isGuest?: boolean;
  model: string;
  mode: "instant" | "think";
  source: "chat" | "guest" | "voice";
  purpose: "main" | "search_decision" | "memory_extraction" | "summary" | "tool_final" | "fallback";
  usage: UsageMetadata | null;
  apiCalls?: number;
  success: boolean;
};

/**
 * Fire-and-forget insert. Never throws, never blocks the reply stream, and
 * never makes an extra AI call — it only records metadata the API already
 * returned.
 */
export async function logGeminiUsage(entry: UsageLogEntry): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const input = entry.usage?.prompt_tokens ?? 0;
    const output = entry.usage?.completion_tokens ?? 0;
    const thinking = entry.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const total = entry.usage?.total_tokens ?? input + output;
    await supabaseAdmin.from("gemini_usage").insert({
      user_id: entry.userId,
      is_guest: entry.isGuest ?? false,
      model: entry.model,
      mode: entry.mode,
      source: entry.source,
      purpose: entry.purpose,
      input_tokens: input,
      output_tokens: output,
      thinking_tokens: thinking,
      total_tokens: total,
      api_calls: entry.apiCalls ?? 1,
      cost_estimate_inr: estimateCostInr(entry.model, input, output, thinking),
      success: entry.success,
    });
  } catch {
    // Usage logging must never break or delay a chat reply.
  }
}

/**
 * Rolling-summary gate. A summary refresh costs one flash-lite call, so it
 * must NOT run on every message: only when the chat has grown well past the
 * live history window AND at least MIN_NEW_MESSAGES new messages have arrived
 * since the last summary.
 */
export const SUMMARY_MIN_TOTAL_MESSAGES = 16;
export const SUMMARY_MIN_NEW_MESSAGES = 8;

export function shouldRefreshSummary(
  totalMessages: number,
  summarizedCount: number,
  hasSummary: boolean,
): boolean {
  if (totalMessages < SUMMARY_MIN_TOTAL_MESSAGES) return false;
  if (!hasSummary) return true;
  return totalMessages - summarizedCount >= SUMMARY_MIN_NEW_MESSAGES;
}
