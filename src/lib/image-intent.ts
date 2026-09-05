export type ImageRequest = {
  prompt: string;
  aspectRatio: "1:1" | "16:9" | "9:16";
};

// Explicit image nouns (English + romanized Manipuri).
const IMAGE_NOUN = /\b(image|images|picture|pictures|pic|pics|photo|photos|photograph|illustration|drawing|painting|artwork|logo|render|wallpaper|poster|thumbnail|sketch|mityeng|chithra|chitra|foto)\b/i;

// Explicit imagining/drawing verbs that only make sense for pictures.
const DRAW_VERB = /\b(draw|sketch|paint|illustrate|render|photograph)\s+/i;

// Generic create verbs (English + Manipuri). Only count as image intent when paired with an image noun.
const CREATE_VERB = /\b(generate|create|make|produce|design|show\s+me|imagine|give\s+me|sembiyu|sembiyou|sembi-?yu|sembiba|sembigadouribani|semmu|sem-?mu|semge|utpiyu|utpi-?yu|utpiyou|sagatpiyu|sagatpiyou|sagat-?piyu)\b/i;

const DALLE_JSON = /\b(dalle|text2im|image_generation|image_url)\b/i;
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
  if (!trimmed) return false;
  if (DALLE_JSON.test(trimmed)) return true;
  if (DRAW_VERB.test(trimmed)) return true;
  // Require BOTH a create verb AND an explicit image noun.
  if (CREATE_VERB.test(trimmed) && IMAGE_NOUN.test(trimmed)) return true;
  return false;
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
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

export function parseImageRequest(text: string): ImageRequest | null {
  if (!looksLikeImagePrompt(text)) return null;
  const prompt = extractImagePrompt(text);
  if (!prompt || prompt.length < 2) return null;
  return { prompt, aspectRatio: extractImageAspectRatio(text) };
}
