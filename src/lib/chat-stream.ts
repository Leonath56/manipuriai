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
  let waitingForMeta = true;
  let metaBuffer = "";
  let streamDone = false;
  let readError: unknown = null;

  // Smooth reveal: show text word-by-word/token-by-token as soon as it arrives.
  // If the network hands us a large burst, keep the message visible and quickly
  // drain the queue instead of dumping the full answer at once or blinking away.
  let rafId: number | null = null;
  let resolveDrain: (() => void) | null = null;
  const drained = new Promise<void>((resolve) => { resolveDrain = resolve; });
  const raf: (cb: () => void) => number =
    typeof requestAnimationFrame === "function"
      ? (cb) => requestAnimationFrame(cb)
      : (cb) => setTimeout(cb, 16) as unknown as number;
  const cancelRaf: (id: number) => void =
    typeof cancelAnimationFrame === "function"
      ? (id) => cancelAnimationFrame(id)
      : (id) => clearTimeout(id);

  const takeRevealChunk = () => {
    if (!pending) return "";
    const backlog = pending.length;
    const targetWords = backlog > 1600 ? 10 : backlog > 700 ? 6 : backlog > 220 ? 3 : 1;
    let idx = 0;
    let words = 0;
    while (idx < pending.length && words < targetWords) {
      while (idx < pending.length && /\s/.test(pending[idx])) idx++;
      while (idx < pending.length && !/\s/.test(pending[idx])) idx++;
      words++;
      while (idx < pending.length && /\s/.test(pending[idx])) idx++;
    }
    if (idx === 0) idx = Math.min(pending.length, 12);
    if (!streamDone && idx === pending.length && backlog < 24 && !/\s/.test(pending)) {
      idx = pending.length;
    }
    const chunk = pending.slice(0, idx);
    pending = pending.slice(idx);
    return chunk;
  };

  const tick = () => {
    rafId = null;
    if (pending.length === 0) {
      if (streamDone) {
        resolveDrain?.();
        resolveDrain = null;
        return;
      }
      rafId = raf(tick);
      return;
    }
    const chunk = takeRevealChunk();
    onChunk(chunk);
    rafId = raf(tick);
  };
  const ensureTick = () => { if (rafId === null) rafId = raf(tick); };

  try {
    while (true) {
      const { done: rDone, value } = await reader.read();
      if (rDone) break;
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
          metaBuffer = "";
          waitingForMeta = false;
        } else {
          chunk = metaBuffer;
          metaBuffer = "";
          waitingForMeta = false;
        }
      }
      // Heartbeats keep the connection alive but should not replace the typing
      // dots with an invisible/blank assistant message.
      chunk = chunk.replace(/\u200B/g, "");
      if (chunk) {
        full += chunk;
        pending += chunk;
        ensureTick();
      }
    }
  } catch (err) {
    readError = err;
  } finally {
    streamDone = true;
  }

  if (readError) {
    if (rafId !== null) { cancelRaf(rafId); rafId = null; }
    throw readError;
  }
  ensureTick();
  await drained;
  return { reply: full };
}
