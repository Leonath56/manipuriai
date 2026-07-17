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
  let pending = "";
  let metaHandled = false;
  let streamDone = false;

  // Smooth reveal: even if the server hands us a big burst of tokens in one
  // network chunk, drip them out to the UI so it reads word-by-word.
  // Rate adapts to backlog so we never fall far behind the model.
  let rafId: number | null = null;
  const raf: (cb: () => void) => number =
    typeof requestAnimationFrame === "function"
      ? (cb) => requestAnimationFrame(cb)
      : (cb) => setTimeout(cb, 16) as unknown as number;
  const cancelRaf: (id: number) => void =
    typeof cancelAnimationFrame === "function"
      ? (id) => cancelAnimationFrame(id)
      : (id) => clearTimeout(id);

  const tick = () => {
    rafId = null;
    if (pending.length === 0) {
      if (streamDone) return;
      rafId = raf(tick);
      return;
    }
    // ~180 chars/sec when caught up; scales up with backlog so long responses
    // don't lag behind the network stream.
    const base = 3;
    const catchUp = Math.ceil(pending.length / 12);
    const take = Math.min(pending.length, Math.max(base, catchUp));
    const chunk = pending.slice(0, take);
    pending = pending.slice(take);
    onChunk(chunk);
    rafId = raf(tick);
  };
  const ensureTick = () => { if (rafId === null) rafId = raf(tick); };

  try {
    while (true) {
      const { done: rDone, value } = await reader.read();
      if (rDone) break;
      let chunk = decoder.decode(value, { stream: true });
      if (!metaHandled && chunk.startsWith("__META__")) {
        const nl = chunk.indexOf("\n");
        if (nl !== -1) {
          const metaLine = chunk.slice(8, nl);
          try {
            const meta = JSON.parse(metaLine);
            onMeta?.(meta);
          } catch { /* ignore */ }
          chunk = chunk.slice(nl + 1);
          metaHandled = true;
        }
      }
      if (chunk) {
        full += chunk;
        pending += chunk;
        ensureTick();
      }
    }
  } finally {
    streamDone = true;
  }

  // Flush anything still queued so the caller sees the final text.
  if (rafId !== null) { cancelRaf(rafId); rafId = null; }
  if (pending.length) {
    onChunk(pending);
    pending = "";
  }
  return { reply: full };
}
