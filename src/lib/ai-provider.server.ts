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

/** How long to wait for upstream response headers before giving up. */
const HEADERS_TIMEOUT_MS = 20_000;

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

  // Serialize once — the payload is the largest thing here (image data URLs make
  // it big), and the fallback path used to JSON.stringify it a second time.
  const bodyFor = (ep: Endpoint) => JSON.stringify({ ...payload, model: ep.model });

  /**
   * Guards only the wait for response *headers*. There was no timeout at all
   * before, so a provider that accepted the socket and then went quiet hung the
   * chat request indefinitely while heartbeats kept the browser waiting.
   *
   * The timer is cleared as soon as headers arrive — a streaming body can take
   * minutes and must not be capped. Client disconnects still abort the body via
   * the chained outer signal.
   */
  const doFetch = async (ep: Endpoint): Promise<Response> => {
    const ctl = new AbortController();
    const outer = init?.signal;
    if (outer) {
      if (outer.aborted) ctl.abort();
      else outer.addEventListener("abort", () => ctl.abort(), { once: true });
    }
    const timer = setTimeout(
      () => ctl.abort(new Error("Upstream AI did not send response headers in time")),
      HEADERS_TIMEOUT_MS,
    );
    try {
      return await fetch(ep.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ep.apiKey}`,
        },
        signal: ctl.signal,
        body: bodyFor(ep),
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const aborted = () => init?.signal?.aborted === true;

  let res: Response;
  try {
    res = await doFetch(primary);
  } catch (err) {
    // A client disconnect must not trigger a fallback — that fired a second
    // upstream request (and billed for it) for a reply nobody was waiting on.
    if (!canFallback || aborted()) throw err;
    return doFetch(fallbackEndpoint());
  }

  const shouldFallback =
    canFallback && !aborted() && (res.status === 429 || res.status >= 500);
  if (shouldFallback) {
    try {
      await res.body?.cancel().catch(() => {});
    } catch { /* ignore */ }
    return doFetch(fallbackEndpoint());
  }
  return res;
}

/**
 * Map Lovable/OpenRouter-style ids to Google's bare Gemini ids.
 *
 * Every id this codebase actually requests must be listed. None of the ids in
 * real use were here before, so on a Gemini-key deployment they all fell through
 * to `gemini-flash-latest`: Think mode silently ran on a flash model instead of
 * pro, and the lite-tier helper calls (web-search decision, memory extraction)
 * were upgraded to flash — slower and more expensive for no benefit.
 *
 * The `-latest` aliases are deliberate for ids Google has no direct equivalent
 * for; the pro/lite *tier* is what matters and it is now preserved.
 */
function mapToGeminiModel(id: string): string {
  const clean = id.replace(/^google\//, "");
  const table: Record<string, string> = {
    // Currently in use.
    "gemini-3.7-flash": "gemini-flash-latest",
    "gemini-3.1-pro-preview": "gemini-pro-latest",
    "gemini-2.5-pro": "gemini-2.5-pro",
    "gemini-2.5-flash": "gemini-2.5-flash",
    "gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
    // Older ids kept so pinned plans keep resolving.
    "gemini-3-flash-preview": "gemini-flash-latest",
    "gemini-2.0-pro-exp-02-05": "gemini-2.0-pro-exp-02-05",
    "gemini-2.0-flash": "gemini-2.0-flash",
    "gemini-2.0-flash-lite": "gemini-2.0-flash-lite",
  };
  if (table[clean]) return table[clean];
  // Unknown id: preserve the tier rather than flattening everything to flash.
  if (clean.includes("pro")) return "gemini-pro-latest";
  if (clean.includes("flash-lite")) return "gemini-flash-lite-latest";
  return "gemini-flash-latest";
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

