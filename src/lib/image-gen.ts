import { supabase } from "@/integrations/supabase/client";

export type ImageGenParams = {
  chatId: string | null;
  prompt: string;
  aspectRatio: "1:1" | "16:9" | "9:16";
  quality: "standard" | "hd";
  count: number;
  style: "realistic" | "anime" | "digital-art" | "oil-painting" | "3d-render" | "pixel-art" | "watercolor" | "none";
};

export type ImageGenResult = { chatId: string; images: string[] };

export async function generateImages(params: ImageGenParams): Promise<ImageGenResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Image generation failed (${res.status})`);
  }
  return (await res.json()) as ImageGenResult;
}

export type ImageMessageMeta = {
  kind: "image";
  prompt: string;
  aspectRatio: "1:1" | "16:9" | "9:16";
  quality: "standard" | "hd";
  style: ImageGenParams["style"];
  images: string[];
};

export type ImageRequest = {
  prompt: string;
  aspectRatio: "1:1" | "16:9" | "9:16";
};

// Extract structured metadata from an assistant message we produced.
export function parseImageMessage(content: string): ImageMessageMeta | null {
  const match = content.match(/```image-generation\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    const meta = JSON.parse(match[1]) as ImageMessageMeta;
    if (meta.kind === "image" && Array.isArray(meta.images)) return meta;
    return null;
  } catch {
    return null;
  }
}

// Regex-based heuristic to detect image-generation intent from natural language and tool-call JSON.
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

function extractAspectRatio(text: string): "1:1" | "16:9" | "9:16" {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const raw = typeof parsed.aspect_ratio === "string" ? parsed.aspect_ratio : typeof parsed.aspectRatio === "string" ? parsed.aspectRatio : null;
    if (raw === "1:1" || raw === "16:9" || raw === "9:16") return raw;
    const actionInput = parsed.action_input;
    if (typeof actionInput === "string") return extractAspectRatio(actionInput);
    if (actionInput && typeof actionInput === "object") return extractAspectRatio(JSON.stringify(actionInput));
  } catch { /* fall through to regex */ }
  const match = text.match(ASPECT_RATIO);
  return (match?.[1] as "1:1" | "16:9" | "9:16" | undefined) ?? "1:1";
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

// Extract a natural-language prompt from a dalle-style JSON action, else return trimmed text.
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
  return { prompt, aspectRatio: extractAspectRatio(text) };
}
