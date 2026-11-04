/**
 * Text chat uses Google directly, without a Lovable fallback.
 * Legacy endpoint selection is retained only for existing media/voice services.
 * Credentials are read when invoked from a server handler, never at module load.
 */

export type AiProvider = "lovable" | "gemini";

export function getChatProvider(): AiProvider {
  // Legacy media/voice routing; text chat does not use this selector.
  if (process.env.LOVABLE_API_KEY) return "lovable";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "lovable";
}

type Endpoint = { url: string; apiKey: string; model: string; provider: AiProvider };

function geminiEndpoint(modelId: string): Endpoint {
  return {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    apiKey: process.env.GEMINI_API_KEY ?? "",
    model: mapToGeminiModel(modelId),
    provider: "gemini",
  };
}

function lovableEndpoint(modelId: string): Endpoint {
  return {
    url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    apiKey: process.env.LOVABLE_API_KEY ?? "",
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

// Connecting to Google should never hang forever: if the upstream hasn't
// responded with headers within this window, fail fast instead of holding the
// request (and the user's quota) open. The timeout is cleared as soon as
// headers arrive, so long streaming replies are NOT cut off.
const CONNECT_TIMEOUT_MS = 45_000;

/**
 * Google-only text completions. Never return raw provider error bodies, which
 * may contain sensitive request details. Successful SSE bodies pass through.
 *
 * Streaming requests automatically ask for `stream_options.include_usage` so
 * the final SSE chunk carries token counts — that is how the usage dashboard
 * gets real numbers without any extra API call.
 */
export async function fetchChatCompletion(
  modelId: string,
  payload: Record<string, unknown>,
  init?: { signal?: AbortSignal },
): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return new Response("Google Gemini is not configured. Please contact the app owner.", { status: 503 });

  // Link the caller's signal with our connect timeout. The timeout only runs
  // until the response headers arrive; after that the stream flows freely.
  const timeoutCtrl = new AbortController();
  const timeout = setTimeout(() => timeoutCtrl.abort(new Error("connect-timeout")), CONNECT_TIMEOUT_MS);
  const onCallerAbort = () => timeoutCtrl.abort(init!.signal!.reason);
  if (init?.signal) {
    if (init.signal.aborted) {
      clearTimeout(timeout);
      throw new DOMException("Request cancelled", "AbortError");
    }
    init.signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let response: Response;
  try {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: timeoutCtrl.signal,
      body: JSON.stringify({
        ...payload,
        model: modelId.replace(/^google\//, ""),
        ...(payload.stream ? { stream_options: { include_usage: true } } : {}),
      }),
    });
  } catch (err) {
    clearTimeout(timeout);
    if (init?.signal) init.signal.removeEventListener("abort", onCallerAbort);
    if (init?.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (timeoutCtrl.signal.aborted) {
      return new Response("Google Gemini took too long to respond. Please try again.", { status: 504 });
    }
    void err;
    return new Response("Google Gemini could not be reached. Please try again.", { status: 502 });
  }
  clearTimeout(timeout);
  if (init?.signal) init.signal.removeEventListener("abort", onCallerAbort);
  if (response.ok) return response;
  await response.body?.cancel().catch(() => {});
  const message = response.status === 401 || response.status === 403
    ? "Google Gemini rejected API access. Please ask the app owner to check the API key and permissions."
    : response.status === 429
      ? "Google Gemini quota or rate limit reached. Please check Google billing or try again later."
      : response.status === 400 || response.status === 404
        ? "Google Gemini could not accept this request or model. Please contact the app owner."
        : "Google Gemini is temporarily unavailable. Please try again later.";
  return new Response(message, { status: response.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Preserve the existing voice chat provider and fallback behavior. */
export async function fetchLegacyChatCompletion(
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
  const bodyFor = (ep: Endpoint) =>
    JSON.stringify({
      ...payload,
      model: ep.model,
      // Lovable AI Gateway fast lane: both chat models in use
      // (google/gemini-3.7-flash, google/gemini-3.1-pro-preview) support
      // priority serving, which lowers time-to-first-token without changing
      // the model or the prompt. Ignored on the direct Gemini endpoint, so
      // only send it to the gateway.
      ...(ep.provider === "lovable" ? { service_tier: "priority" } : {}),
    });

  const doFetch = (ep: Endpoint): Promise<Response> =>
    fetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ep.apiKey}`,
      },
      // Generation can legitimately take time. Only an explicit user cancel
      // aborts the request; artificial deadlines discard still-running work.
      signal: init?.signal,
      body: bodyFor(ep),
    });

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

