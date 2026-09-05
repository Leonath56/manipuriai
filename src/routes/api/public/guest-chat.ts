import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { fetchChatCompletion } from "@/lib/ai-provider.server";
import { validateImageInputs } from "@/lib/image-input";

const GUEST_FREE_LIMIT = 3;
const GUEST_MAX_IMAGES = 4;

/**
 * Collapse control characters to spaces.
 *
 * Written as a scan rather than a regex class so the escape sequences for
 * U+0000–U+001F never have to survive a reformat — an editor that ate them would
 * silently turn this into a no-op.
 */
function foldControlChars(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

const BodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    /*
     * The name is interpolated into the system prompt, so control characters and
     * newlines — the shape a "\n# NEW INSTRUCTIONS" injection needs — are folded
     * to spaces. This does not eliminate prompt injection; it removes the
     * cheapest way to forge a new prompt section from an unauthenticated caller.
     */
    .transform(foldControlChars)
    .refine((s) => s.length > 0, "Name required"),
  guestId: z.string().trim().min(4).max(80),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(10)
    .default([]),
  message: z.string().trim().min(1).max(2000),
  language: z.enum(["auto", "mni", "mni-mtei", "en"]).default("auto"),
  // Shape is checked by validateImageInputs below, which enforces the data-URL
  // scheme, the mime allowlist and the byte caps that Zod can't express cheaply.
  images: z.unknown().optional(),
});

const ROMANIZED_MEITEILON_REGEX = /\b(khurumjari|nungairibra|nungai|kadaino|kari|karino|karigi|karamba|eigi|eina|eidi|nang|nangbu|nahak|adom|yamna|phajana|thagatchari|mateng|touba|touri|touge|leiri|leibra|leitre|chatpa|chatli|lakpa|laakpa|khangba|khangde|haibiyu|haige|pambadi|oiribra|oire|natte|hoi|yare|yaroi|ngasi|hayeng|matam|thabak|yumda|imphal)\b/i;
const MEITEI_MAYEK_REGEX = /[ꯀ-꯿]/;

function resolveReplyLanguage(language: z.infer<typeof BodySchema>["language"], message: string) {
  if (language !== "auto") return language;
  if (MEITEI_MAYEK_REGEX.test(message)) return "mni-mtei" as const;
  if (ROMANIZED_MEITEILON_REGEX.test(message)) return "mni" as const;
  return "en" as const;
}

/**
 * Reserve one message against the free-trial allowance, before the model runs.
 *
 * The count used to be read here and incremented only after the reply finished
 * streaming, so requests fired in parallel all saw the same count and all
 * passed — a `for` loop lifted the 3-message limit on an unauthenticated,
 * pay-per-token endpoint. Reserving up front closes that window, and the UPDATE
 * carries the old count in its WHERE clause, which makes it a compare-and-swap
 * Postgres resolves atomically: the loser sees zero rows affected and retries
 * against the new value.
 */
async function reserveGuestMessage(opts: {
  guestId: string;
  name: string;
  userAgent: string | null;
  ipHint: string | null;
}): Promise<{ ok: true; sessionId: string } | { ok: false }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: existing } = await supabaseAdmin
      .from("guest_sessions")
      .select("id, message_count")
      .eq("guest_id", opts.guestId)
      .maybeSingle();

    // Also cap by IP so rotating the client-generated guestId can't reset the
    // allowance.
    let usedByIp = 0;
    if (opts.ipHint) {
      const { data: ipRows } = await supabaseAdmin
        .from("guest_sessions")
        .select("message_count")
        .eq("ip_hint", opts.ipHint);
      usedByIp = (ipRows ?? []).reduce((s, r) => s + (r.message_count ?? 0), 0);
    }

    const used = Math.max(existing?.message_count ?? 0, usedByIp);
    if (used >= GUEST_FREE_LIMIT) return { ok: false };

    if (existing) {
      const prev = existing.message_count ?? 0;
      const { data: won } = await supabaseAdmin
        .from("guest_sessions")
        .update({
          name: opts.name,
          message_count: prev + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("message_count", prev)
        .select("id");
      if (won && won.length > 0) return { ok: true, sessionId: existing.id };
      continue; // lost the race — re-read and decide again
    }

    const { data: created } = await supabaseAdmin
      .from("guest_sessions")
      .insert({
        guest_id: opts.guestId,
        name: opts.name,
        message_count: 1,
        user_agent: opts.userAgent,
        ip_hint: opts.ipHint,
      })
      .select("id")
      .single();
    if (created) return { ok: true, sessionId: created.id };
    // `guest_id` is UNIQUE, so a failed insert means a concurrent request created
    // the row; the next pass finds it and takes the update path.
  }

  // Every attempt lost the race. Refusing is the safe end of that branch.
  return { ok: false };
}

/**
 * Hand the reserved message back when the model produced nothing at all, so a
 * provider outage doesn't silently spend someone's free trial.
 */
async function releaseGuestMessage(sessionId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("guest_sessions")
      .select("message_count")
      .eq("id", sessionId)
      .maybeSingle();
    const prev = data?.message_count ?? 0;
    if (prev <= 0) return;
    await supabaseAdmin
      .from("guest_sessions")
      .update({ message_count: prev - 1 })
      .eq("id", sessionId)
      .eq("message_count", prev);
  } catch {
    // Best effort. Over-counting by one is preferable to failing the response.
  }
}

/** Transcript only — the allowance was already spent by reserveGuestMessage. */
async function recordGuestTurn(opts: {
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("guest_messages").insert([
      { guest_session_id: opts.sessionId, role: "user", content: opts.userMessage },
      { guest_session_id: opts.sessionId, role: "assistant", content: opts.assistantMessage },
    ]);
  } catch {
    // best-effort; never fail the reply because of logging
  }
}

const SYSTEM_PROMPT = `You are Manipuri AI version 1.2, a highly capable general assistant with native-level Meiteilon ability. This is a first-impression free trial. Answer the current request directly and accurately.

Only when asked who you are or who made you, say: "Ei Manipuri AI version 1.2 ni. Eibu sembiba na Loitam Leonath ni." Do not mention the underlying model or provider.

CONVERSATION
- Prioritize the current message. Use history only when it is relevant or the user refers back to it.
- Never introduce unrelated subjects from earlier turns.
- For a greeting-only message, give one brief natural greeting. Vary repeated greetings without adding a list of suggested topics.
- For an ambiguous short follow-up, ask one short clarifying question rather than guessing.
- Keep simple replies concise. Use Markdown only when it improves a structured answer.

MEITEILON QUALITY
- Write contemporary native Meiteilon, not a literal translation from English.
- Use natural SOV order, but do not mechanically distort fragments, headings, quotations, or established expressions.
- Attach case markers and suffixes naturally: -na, -bu/-pu, -da/-ta, -dagi, -ga, -gi, and -di.
- Keep sentences short, spelling consistent, and politeness consistent.
- Avoid Bengali/Hindi substitutions such as ami, tumi, ache, dhanyabad, kemon, kothay, keno, sahayak, kaj, somoy, khub, bhalo, ekta, and kintu.
- Prefer native forms where confident: ei/eigi, nang/nanggi, adom/adomgi, kari, karigi, kadaida, mateng, thabak, matam, yamna, phaba, ama, adubu, lei/leiri, khangba, touba, piba, phangba, yengba, haiba, chatpa, laakpa, thagatchari, khurumjari, and nungairibra.
- Keep familiar English terms such as phone, internet, AI, app, video, school, college, code, file, upload, and download when native speakers normally do.
- Never invent a Meiteilon word. If uncertain, use a simple native paraphrase or a familiar English term.
- Mirror natural Manipuri-English code-mixing rather than forcing artificial language purity.

Be warm and helpful, and remain neutral and respectful on ethnic, religious, or political topics.`;

export const Route = createFileRoute("/api/public/guest-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!process.env.LOVABLE_API_KEY && !process.env.GEMINI_API_KEY) {
            return new Response("AI not configured", { status: 500 });
          }

          const body = BodySchema.parse(await request.json());

          // Bounded here rather than in Zod: the caps that matter are decoded
          // byte size and the data-URL scheme, and this route is reachable
          // without an account.
          const imageCheck = validateImageInputs(body.images, { maxCount: GUEST_MAX_IMAGES });
          if (!imageCheck.ok) {
            return new Response(JSON.stringify({ error: imageCheck.reason }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const images = imageCheck.images;

          const ua = request.headers.get("user-agent");
          const ipHint =
            request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            null;

          // Server-enforced free-trial limit. Do NOT trust any client counter.
          // Spent before the model runs, and refunded below if nothing streamed.
          const reservation = await reserveGuestMessage({
            guestId: body.guestId,
            name: body.name,
            userAgent: ua,
            ipHint,
          });
          if (!reservation.ok) {
            return new Response(
              JSON.stringify({
                error: "Free trial limit reached. Please sign up to continue.",
                limit: GUEST_FREE_LIMIT,
              }),
              { status: 429, headers: { "Content-Type": "application/json" } },
            );
          }
          const sessionId = reservation.sessionId;

          const replyLanguage = resolveReplyLanguage(body.language, body.message);
          const languageHint =
            replyLanguage === "mni"
              ? "\n\n# LANGUAGE CONTRACT — ROMANIZED MEITEILON\nReply in natural Romanized Meiteilon using Latin letters. Match the user's casual spelling and formality. Use idiomatic grammar and attached suffixes without forcing rigid textbook patterns. Silently remove invented words and translation-like phrasing before sending."
              : replyLanguage === "mni-mtei"
                ? "\n\n# LANGUAGE CONTRACT — MEITEI MAYEK\nReply in natural Meiteilon written in Meitei Mayek. Do not output a Latin transliteration first. Keep code, URLs, numbers, and proper nouns in their original form. Never invent spellings or vocabulary."
                : "\n\n# LANGUAGE CONTRACT — ENGLISH\nReply in fluent natural English. Do not add Manipuri greetings or fillers unless the user asks for them.";

          const userInfo = `\n\n# USER PROFILE\n- The user's name is: ${body.name}\n- Address them by name naturally. Never call them "Khullak", "Marup", or a placeholder.`;

          // `content` is a plain string for text turns and an OpenAI-style parts
          // array when images are attached, so the union is declared rather than
          // cast away.
          const messages: { role: string; content: string | Record<string, unknown>[] }[] = [
            { role: "system", content: SYSTEM_PROMPT + userInfo + languageHint },
            ...body.history.map((m) => ({ role: m.role, content: m.content })),
            {
              role: "user",
              content: images.length
                ? [
                    { type: "text", text: body.message },
                    ...images.map((url) => ({ type: "image_url", image_url: { url } })),
                  ]
                : body.message,
            },
          ];

          const encoder = new TextEncoder();
          const decoder = new TextDecoder();
          let assistantAcc = "";

          const stream = new ReadableStream({
            async start(controller) {
              let buffer = "";
              let closed = false;
              const safeEnqueue = (chunk: Uint8Array) => {
                if (closed || request.signal.aborted) return false;
                try {
                  controller.enqueue(chunk);
                  return true;
                } catch {
                  closed = true;
                  return false;
                }
              };
              const safeClose = () => {
                if (closed) return;
                closed = true;
                try { controller.close(); } catch {}
              };

              // Open the response stream before waiting for the model. This lets
              // the trial UI display its thinking state immediately instead of
              // appearing frozen during the upstream connection.
              let upstream: Response;
              try {
                upstream = await fetchChatCompletion(
                  "google/gemini-3.7-flash",
                  { messages, stream: true },
                  { signal: request.signal },
                );
              } catch (err) {
                if (!request.signal.aborted) {
                  console.error("[guest-chat] upstream connection failed", (err as Error)?.message);
                  safeEnqueue(encoder.encode("Manipuri AI couldn't answer just now. Please try again."));
                }
                await releaseGuestMessage(sessionId);
                safeClose();
                return;
              }

              if (!upstream.ok || !upstream.body) {
                const detail = await upstream.text().catch(() => "");
                console.error("[guest-chat] upstream failed", upstream.status, detail.slice(0, 300));
                safeEnqueue(encoder.encode("Manipuri AI couldn't answer just now. Please try again."));
                await releaseGuestMessage(sessionId);
                safeClose();
                return;
              }

              const reader = upstream.body.getReader();
              const onAbort = () => { reader.cancel().catch(() => {}); };
              request.signal.addEventListener("abort", onAbort);
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split("\n");
                  buffer = lines.pop() ?? "";
                  for (const raw of lines) {
                    const line = raw.trim();
                    if (!line.startsWith("data:")) continue;
                    const payload = line.slice(5).trim();
                    if (payload === "[DONE]") continue;
                    try {
                      const j = JSON.parse(payload);
                      const delta: string | undefined =
                        j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content;
                      if (delta) {
                        const fixed = delta.replace(/pangbageda/gi, "mateng pangjouge");
                        assistantAcc += fixed;
                        if (!safeEnqueue(encoder.encode(fixed))) {
                          await reader.cancel().catch(() => {});
                          return;
                        }
                      }
                    } catch {
                      // ignore
                    }
                  }
                }
              } catch (err) {
                if (request.signal.aborted || closed || (err as Error)?.name === "AbortError") {
                  // Cancelled with nothing shown: give the message back.
                  if (!assistantAcc) await releaseGuestMessage(sessionId);
                  safeClose();
                  return;
                }
                console.error("[guest-chat] stream failed", (err as Error)?.message);
                if (!assistantAcc) await releaseGuestMessage(sessionId);
                try { controller.error(err); } catch {}
                closed = true;
                return;
              } finally {
                request.signal.removeEventListener("abort", onAbort);
              }

              if (assistantAcc) {
                // Await so the Worker doesn't terminate the persist promise
                // when the response stream closes.
                await recordGuestTurn({
                  sessionId,
                  userMessage: body.message,
                  assistantMessage: assistantAcc,
                });
              } else {
                // Provider closed the stream without emitting a token.
                await releaseGuestMessage(sessionId);
              }

              safeClose();
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
            },
          });
        } catch (err) {
          /*
           * The raw `err.message` used to go back to the caller. On a public
           * endpoint that leaked Zod paths, Supabase errors and internal wiring
           * to anyone who could POST malformed JSON, so the detail is logged and
           * the response says only which side was at fault.
           */
          const invalid = err instanceof z.ZodError || err instanceof SyntaxError;
          if (!invalid) console.error("[guest-chat] request failed", err);
          return new Response(
            JSON.stringify({
              error: invalid
                ? "That message couldn't be read. Please try again."
                : "Something went wrong on our side. Please try again.",
            }),
            {
              status: invalid ? 400 : 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});
