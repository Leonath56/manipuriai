/**
 * AI provider abstraction so the same codebase runs on:
 *  - Lovable (uses LOVABLE_API_KEY → Lovable AI Gateway)
 *  - Self-hosted VPS (set GEMINI_API_KEY → Google Gemini OpenAI-compatible endpoint,
 *    no Lovable credits consumed)
 *
 * How the switch works: if GEMINI_API_KEY is set, chat completions go to Google
 * directly. Otherwise they go to Lovable AI Gateway.
 *
 * Image generation, TTS and transcription still go through Lovable Gateway
 * (Google's OpenAI-compat endpoint does not expose them). Keep LOVABLE_API_KEY
 * set for those features, or the endpoints return a clear error.
 */

export type AiProvider = "lovable" | "gemini";

export function getChatProvider(): AiProvider {
  // Prefer Lovable AI Gateway whenever a key is present (user has credits).
  // Fall back to a direct Gemini key only when Lovable is not configured.
  if (process.env.LOVABLE_API_KEY) return "lovable";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "lovable";
}

type Endpoint = { url: string; apiKey: string; model: string; provider: AiProvider };

function geminiEndpoint(modelId: string): Endpoint {
  return {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    apiKey: process.env.GEMINI_API_KEY!,
    model: mapToGeminiModel(modelId),
    provider: "gemini",
  };
}

function lovableEndpoint(modelId: string): Endpoint {
  return {
    url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    apiKey: process.env.LOVABLE_API_KEY!,
    model: modelId,
    provider: "lovable",
  };
}

/**
 * Returns { url, apiKey, model } ready for a chat completions POST.
 * `modelId` is the Lovable-style id used everywhere in the codebase
 * (e.g. "google/gemini-2.5-flash"); this function rewrites it for the
 * selected provider.
 */
export function chatCompletionsEndpoint(modelId: string): Endpoint {
  return getChatProvider() === "gemini" ? geminiEndpoint(modelId) : lovableEndpoint(modelId);
}

/**
 * Fetch a chat completion with automatic fallback to the other provider on
 * 429 (rate limit) or 5xx from the primary. If GEMINI_API_KEY is set, we try
 * Gemini first, then Lovable AI Gateway when Gemini rate-limits or errors.
 * This keeps chats working when the free Gemini quota is exhausted.
 *
 * `payload` is the OpenAI-style body minus `model` (we inject the right one
 * per provider). Returns the raw Response; caller handles streaming or JSON.
 */
export async function fetchChatCompletion(
  modelId: string,
  payload: Record<string, unknown>,
  init?: { signal?: AbortSignal },
): Promise<Response> {
  const primary = chatCompletionsEndpoint(modelId);
  const canFallback =
    (primary.provider === "gemini" && !!process.env.LOVABLE_API_KEY) ||
    (primary.provider === "lovable" && !!process.env.GEMINI_API_KEY);
  const fallbackEndpoint = (): Endpoint =>
    primary.provider === "lovable" ? geminiEndpoint(modelId) : lovableEndpoint(modelId);

  const doFetch = (ep: Endpoint) =>
    fetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ep.apiKey}`,
      },
      signal: init?.signal,
      body: JSON.stringify({ ...payload, model: ep.model }),
    });

  let res: Response;
  try {
    res = await doFetch(primary);
  } catch (err) {
    if (!canFallback) throw err;
    return doFetch(fallbackEndpoint());
  }

  const shouldFallback =
    canFallback && (res.status === 429 || res.status >= 500);
  if (shouldFallback) {
    try {
      await res.body?.cancel().catch(() => {});
    } catch { /* ignore */ }
    return doFetch(fallbackEndpoint());
  }
  return res;
}

/** Map Lovable/OpenRouter-style ids to Google's bare Gemini ids. */
function mapToGeminiModel(id: string): string {
  const clean = id.replace(/^google\//, "");
  const table: Record<string, string> = {
    "gemini-3-flash-preview": "gemini-flash-latest",
    "gemini-3.1-pro-preview": "gemini-pro-latest",
    "gemini-3.1-flash-lite": "gemini-flash-lite-latest",
    "gemini-2.5-pro": "gemini-pro-latest",
    "gemini-2.5-flash": "gemini-flash-latest",
    "gemini-2.5-flash-lite": "gemini-flash-lite-latest",
  };
  return table[clean] ?? "gemini-flash-latest";
}

/**
 * Lovable-only endpoints (image gen, TTS, transcription). Returns null when
 * LOVABLE_API_KEY is missing (self-hosted user has disabled these features).
 */
export function lovableOnlyEndpoint(): { baseUrl: string; apiKey: string } | null {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  return { baseUrl: "https://ai.gateway.lovable.dev/v1", apiKey: key };
}

