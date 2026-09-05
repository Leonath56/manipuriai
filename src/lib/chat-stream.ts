import { supabase } from "@/integrations/supabase/client";

export type StreamChatInput = {
  chatId: string | null;
  message: string;
  language: "auto" | "mni" | "mni-mtei" | "en";
  mode: "instant" | "think";
  images?: string[]; // data URLs
  source?: "chat" | "voice";
  /**
   * Ids of persisted rows this turn is replacing (regenerate / edit-and-resend).
   * They stay in the database until this turn succeeds — the server only hides
   * them from the model's history so it doesn't see the old turn twice.
   */
  omitMessageIds?: string[];
  onChunk: (delta: string) => void;
  onMeta?: (meta: { chatId: string }) => void;
  signal?: AbortSignal;
};

export async function streamChat({ chatId, message, language, mode, images, source, omitMessageIds, onChunk, onMeta, signal }: StreamChatInput) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");

  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        chatId,
        message,
        language,
        mode,
        images: images ?? [],
        source: source ?? "chat",
        omitMessageIds: omitMessageIds ?? [],
      }),
    });
  } catch (err) {
    // Stopped before the response headers arrived — nothing was generated, but
    // this is still a stop rather than a failure, so don't surface an error.
    if ((err as { name?: string })?.name === "AbortError" || signal?.aborted) {
      return { reply: "", aborted: true };
    }
    throw err;
  }

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
  let aborted = false;

  // Text is forwarded as soon as it arrives. There is deliberately no artificial
  // per-word delay here: the old version awaited 10–25ms per word, which for a
  // 400-word reply added 4–10s of pure latency on top of the model, and made
  // Stop feel unresponsive because a long queue of already-received words was
  // still draining. Smoothness is the renderer's job (see the animation in
  // StreamingAssistantContent), not the transport's.
  let contentBuffer = "";
  try {
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
        contentBuffer += chunk;

        // Emit on whole-word boundaries so a word never renders half-drawn, but
        // emit everything that is ready in one call \u2014 one state update per
        // network chunk instead of one per word.
        const lastIsSpace = /\s$/.test(contentBuffer);
        if (lastIsSpace) {
          onChunk(contentBuffer);
          contentBuffer = "";
        } else {
          const cut = Math.max(contentBuffer.lastIndexOf(" "), contentBuffer.lastIndexOf("\n"));
          if (cut !== -1) {
            onChunk(contentBuffer.slice(0, cut + 1));
            contentBuffer = contentBuffer.slice(cut + 1);
          }
        }
      }
    }
  } catch (err) {
    // Stopping a reply is a normal outcome, not a failure. Swallow it here and
    // report it through the return value so the caller keeps everything that
    // was already streamed \u2014 rethrowing used to discard the partial reply.
    const isAbort = (err as { name?: string })?.name === "AbortError" || signal?.aborted;
    if (!isAbort) throw err;
    aborted = true;
  } finally {
    // Release the lock either way; cancel() on an aborted body is a no-op.
    try { await reader.cancel(); } catch { /* already closed */ }
  }

  // Flush remaining buffer
  if (contentBuffer) {
    onChunk(contentBuffer);
  }

  return { reply: full, aborted };
}
