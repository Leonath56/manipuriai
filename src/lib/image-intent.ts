export type ImageRequest = {
  prompt: string;
  aspectRatio: "1:1" | "16:9" | "9:16";
};

const IMAGE_INTENT = /\b(generate|create|make|draw|paint|render|design|show me|imagine|picture|image|photo|artwork|illustration|logo)\s+(a|an|the|me|some|of)?\s*(image|picture|photo|illustration|drawing|painting|artwork|logo|render)\b/i;
const IMAGE_START = /^\s*(image|picture|photo|draw|paint|render|generate image|create image|make image)\s*[:\-]/i;
const DALLE_JSON = /\b(dalle|text2im|image_generation|image_url)\b/i;
const VISUAL_VERB = /^\s*(please\s+)?(generate|create|make|draw|paint|render|design)\s+(me\s+)?(a|an|the|some)?\s*\S+/i;
const TEXT_GENERATION_TARGET = /\b(code|program|app|website|essay|story|poem|song|caption|reply|answer|summary|translation|table|list|email|letter|script|function|regex|sql|json|html|css|javascript|typescript)\b/i;
const ASPECT_RATIO = /"(?:aspect_ratio|aspectRatio)"\s*:\s*"(1:1|16:9|9:16)"/i;
const PROMPT_FIELD = /"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/i;

function parseJsonPrompt(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.prompt === "string" && record.prompt.trim()) return record.prompt.trim();
  const actionInput = record.action_input;
  if (typeof actionInput === "string") {
    try {
      return parseJsonPrompt(JSON.parse(actionInput));
    } catch {
      const match = actionInput.match(PROMPT_FIELD);
      if (match) {
        try { return JSON.parse(`"${match[1]}"`).trim(); } catch { return match[1].trim(); }
      }
    }
  }
  if (actionInput && typeof actionInput === "object") return parseJsonPrompt(actionInput);
  return null;
}

export function looksLikeImagePrompt(text: string): boolean {
  const trimmed = text.trim();
  return (
    IMAGE_INTENT.test(trimmed) ||
    IMAGE_START.test(trimmed) ||
    DALLE_JSON.test(trimmed) ||
    (VISUAL_VERB.test(trimmed) && !TEXT_GENERATION_TARGET.test(trimmed))
  );
}

export function extractImageAspectRatio(text: string): "1:1" | "16:9" | "9:16" {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const raw = typeof parsed.aspect_ratio === "string" ? parsed.aspect_ratio : typeof parsed.aspectRatio === "string" ? parsed.aspectRatio : null;
    if (raw === "1:1" || raw === "16:9" || raw === "9:16") return raw;
    const actionInput = parsed.action_input;
    if (typeof actionInput === "string") return extractImageAspectRatio(actionInput);
    if (actionInput && typeof actionInput === "object") return extractImageAspectRatio(JSON.stringify(actionInput));
  } catch { /* fall through to regex */ }
  const match = text.match(ASPECT_RATIO);
  return (match?.[1] as "1:1" | "16:9" | "9:16" | undefined) ?? "1:1";
}

export function extractImagePrompt(text: string): string {
  try {
    const parsedPrompt = parseJsonPrompt(JSON.parse(text));
    if (parsedPrompt) return parsedPrompt;
  } catch { /* invalid JSON is common when users paste tool-call text */ }
  const m = text.match(PROMPT_FIELD);
  if (m) {
    try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
  }
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^\s*(please\s+)?(generate|create|make|draw|paint|render|design)\s+(me\s+)?(a|an|the|some)?\s*(image|picture|photo|illustration|drawing|painting|artwork|logo|render)?\s*(of|for)?\s*/i, "")
    .replace(/^\s*(image|picture|photo)\s*[:\-]\s*/i, "")
    .trim();
}

export function parseImageRequest(text: string): ImageRequest | null {
  if (!looksLikeImagePrompt(text)) return null;
  const prompt = extractImagePrompt(text);
  if (!prompt || prompt.length < 2) return null;
  return { prompt, aspectRatio: extractImageAspectRatio(text) };
}