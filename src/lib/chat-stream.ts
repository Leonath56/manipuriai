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

  // Smooth reveal: emit one visible word/token at a time. The network can send
  // large bursts, but the UI should never dump a paragraph or clear while
  // waiting for the rest of a long reply.
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let resolveDrain: (() => void) | null = null;
  const drained = new Promise<void>((resolve) => { resolveDrain = resolve; });

  const takeRevealChunk = () => {
    if (!pending) return "";
    const firstWord = pending.match(/^(\s*\S+\s*)/);
    if (firstWord) {
      const token = firstWord[1];
      const hasCompletedWord = /\s$/.test(token) || streamDone || pending.length > 40;
      if (!hasCompletedWord) return "";
      pending = pending.slice(token.length);
      return token;
    }
    if (!streamDone) return "";
    const chunk = pending;
    pending = "";
    return chunk;
  };

  const nextDelay = () => {
    if (pending.length > 2200) return 10;
    if (pending.length > 900) return 16;
    if (pending.length > 260) return 24;
    return 34;
  };

  const scheduleTick = (delay = nextDelay()) => {
    if (timerId !== null) return;
    timerId = setTimeout(tick, delay);
  };

  const tick = () => {
    timerId = null;
    if (pending.length === 0) {
      if (streamDone) {
        resolveDrain?.();
        resolveDrain = null;
        return;
      }
      scheduleTick(24);
      return;
    }
    const chunk = takeRevealChunk();
    if (chunk) onChunk(chunk);
    if (pending.length > 0 || !streamDone) scheduleTick(chunk ? nextDelay() : 18);
    else {
      resolveDrain?.();
      resolveDrain = null;
    }
  };
  const ensureTick = () => { scheduleTick(0); };

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
    if (timerId !== null) { clearTimeout(timerId); timerId = null; }
    throw readError;
  }
  ensureTick();
  await drained;
  return { reply: full };
}
