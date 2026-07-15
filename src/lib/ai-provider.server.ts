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
  return process.env.GEMINI_API_KEY ? "gemini" : "lovable";
}

/**
 * Returns { url, apiKey, model } ready for a chat completions POST.
 * `modelId` is the Lovable-style id used everywhere in the codebase
 * (e.g. "google/gemini-2.5-flash"); this function rewrites it for the
 * selected provider.
 */
export function chatCompletionsEndpoint(modelId: string): {
  url: string;
  apiKey: string;
  model: string;
} {
  const provider = getChatProvider();
  if (provider === "gemini") {
    return {
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      apiKey: process.env.GEMINI_API_KEY!,
      model: mapToGeminiModel(modelId),
    };
  }
  return {
    url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    apiKey: process.env.LOVABLE_API_KEY!,
    model: modelId,
  };
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
