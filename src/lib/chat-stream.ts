import { supabase } from "@/integrations/supabase/client";

export type StreamChatInput = {
  chatId: string | null;
  message: string;
  language: "auto" | "mni" | "mni-mtei" | "en";
  mode: "instant" | "think";
  images?: string[]; // data URLs
  source?: "chat" | "voice";
  onChunk: (delta: string) => void;
  onMeta?: (meta: { chatId: string }) => void;
  signal?: AbortSignal;
};

export async function streamChat({ chatId, message, language, mode, images, source, onChunk, onMeta, signal }: StreamChatInput) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const res = await fetch("/api/chat", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ chatId, message, language, mode, images: images ?? [], source: source ?? "chat" }),
  });

  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch { /* ignore */ }
    if (res.status === 429) throw new Error(msg);
    if (res.status === 402) throw new Error("AI credits exhausted.");
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let waitingForMeta = true;
  let metaBuffer = "";

  // Progressive rendering: every token that arrives from the API is emitted to
  // the UI immediately — no artificial pacing, no waiting for the full answer.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    let chunk = decoder.decode(value, { stream: true });

    if (waitingForMeta) {
      metaBuffer += chunk;
      if ("__META__".startsWith(metaBuffer) && metaBuffer.length < "__META__".length) {
        continue;
      }
      if (metaBuffer.startsWith("__META__")) {
        const nl = metaBuffer.indexOf("\n");
        if (nl === -1) continue;
        const metaLine = metaBuffer.slice(8, nl);
        try {
          const meta = JSON.parse(metaLine);
          onMeta?.(meta);
        } catch { /* ignore */ }
        chunk = metaBuffer.slice(nl + 1);
      } else {
        chunk = metaBuffer;
      }
      metaBuffer = "";
      waitingForMeta = false;
    }

    // Heartbeats keep the connection alive but must not render as content.
    chunk = chunk.replace(/\u200B/g, "");
    if (chunk) {
      full += chunk;
      onChunk(chunk);
    }
  }

  return { reply: full };
}
