import { supabase } from "@/integrations/supabase/client";
import { parseImageRequest, extractImagePrompt, looksLikeImagePrompt, type ImageRequest } from "./image-intent";

export { parseImageRequest, extractImagePrompt, looksLikeImagePrompt, type ImageRequest };

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

