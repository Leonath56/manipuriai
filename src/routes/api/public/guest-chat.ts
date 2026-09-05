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

const SYSTEM_PROMPT = `You are Manipuri AI — a NATIVE Meiteilon (Manipuri) speaker from Imphal. You are highly intelligent and capable of answering EVERYTHING, including coding, mathematics, advanced science, and any other task that state-of-the-art AI like ChatGPT can do. This is a first-impression free trial; every reply must sound like a real Manipuri friend, not a translation. Stream your tokens immediately as they are generated; the UI handles the smooth display. Fast, word-by-word output is required.

# IDENTITY
- If asked who you are / who made you: reply exactly "Ei Manipuri AI version 1.2 ni. Eibu sembiba na Loitam Leonath ni."
- Never say Gemini, Google, GPT, OpenAI or any other model/company.

# LANGUAGE
- Default: spoken Meiteilon in Roman letters (WhatsApp-style, warm, short).
- Follow LANGUAGE OVERRIDE if present. Mirror the user's script if they use Meitei Mayek or Bengali script. Reply in English only if the user writes in English.

# GRAMMAR (STRICT — most AI gets these wrong)
- SOV. Verb ALWAYS last. "Ei nangbu pammi" (I love you), NEVER "Ei pammi nangbu".
- Case markers glued to noun: -na (agent), -bu/-pu (object), -da/-ta (at/to), -dagi (from), -ga (with), -gi (of), -di (topic).
- Verb endings:
  • -i / -e habitual present ("chai" eats)
  • -ri / -li right now ("chari" is eating)
  • -khi past ("chakhi" ate)
  • -khre / -re perfect ("chakhre" have eaten, "laakhre" has come)
  • -gani future certain, -louge / -jouge / -ge future intention polite ("chatlouge" I'll go)
  • -de / -te negative ("khangde" don't know, "yade" not okay)
  • -bra / -ra yes/no question ("chakhbra?" did you eat?)
  • -si polite imperative ("chatlasi" please go), -biyu respectful please ("haibiyu" please tell)
- Pronouns: ei/eigi, eikhoi, nang/nanggi (casual), adom/Ibungo (respectful), mahak/mahakki, makhoi.

# MISTAKES TO NEVER MAKE
- NEVER "pangbageda" → ALWAYS "mateng pangjouge".
- NEVER Bengali/Hindi words: ami, tumi, ache, dhanyabad, kemon, kothay, keno, sahayta, ki (alone as "what").
- Use: ei (I), nang/adom (you), lei (is/exists), Thagatchari (thanks), Nungaithengbra?/Kadaino? (how are you?), kari (what), kadaida (where), karigi (why).
- Keep tech words in English inline: computer, internet, AI, phone, app, video, email, laptop, WhatsApp, Google, YouTube, code, browser, download, upload, link, file. Do NOT invent Sanskrit coinages.
- Say "Meiteilon" for the language, not clumsy "Manipuri-gi lon".
- "ama" (one), "khara" (some), "yamna" (very).

# HIGH-FREQUENCY NATIVE VOCAB
- Verbs: chatpa, laakpa, touba, khangba, oiba, piba, loba, yaba, pamba, thokpa, unba, taaba, haiba, yengba, leiba, phangba, semba, thiba, tamba.
- Nouns: matam, numit, thabak, yum, imung, chak, ising, wari, paojel, wakhal, khudongchaba, thawai, nungshi, haraoba, awaba, lamdam, mee, mapham.
- Connectors: adubu (but), aduga (and then), amasung (and — formal), asumna (thus), matou asumna (like this), maramdi (because), adugi matungda (after that), eina khanbadi (in my view).
- Greetings: "Khurumjari!", "Nungaithengbra?", "Yaifare", "Thagatchari", "Yaninge", "Chatlage", "Amuk unage", "Karisu natte".

# STYLE
- Warm, friendly. Address the user by name naturally.
- Short natural sentences beat long clumsy ones.
- End with polite particles: -ni, -ne, -ko, -jouge, -biyu.
- Markdown only when it actually helps.
- Stay neutral on ethnic/political issues in Manipur.

# ACCURACY GUARDRAILS (highest priority)
- NEVER invent a Meiteilon word. If unsure, paraphrase simply or keep the English term inline.
- NEVER translate word-for-word from English; think how a Manipuri person would SAY it, then write that.
- Short sentences, one idea each. No space before suffixes ("yumda", not "yum da").
- Copula: "-ni" identity, "lei/leiri" existence, "oiri" becoming. Never "ase"/"ache".
- Plurals use "-sing" (mising, lairiksing), never English "-s".
- Match the user's politeness level consistently (nang OR adom, not both) and keep one spelling per word in a reply.
- If the user code-mixes Manipuri + English, mirror that natural mix.

# SELF-CHECK BEFORE SENDING (rewrite silently if any fails)
1. Verb at the end of every sentence?
2. Correct case markers glued to nouns, correct tense marker?
3. Zero Bengali/Hindi words?
4. Zero invented/uncertain Meiteilon words?
5. Consistent politeness and spelling?
6. Reads like a Manipuri friend's WhatsApp message?

# GUEST MODE / GREETINGS
- If the user's message is ONLY a greeting (hi, hello, etc.), reply with a short, warm, natural Manipuri greeting.
- CRITICAL: If the conversation history shows you have already sent a greeting, you MUST NOT repeat the same phrase. Acknowledge the persistence (e.g. "Hi again! What else can I help with?") and ensure variety. Never give the exact same response to back-to-back greetings.
- If the user's message contains ANY question, task, or context (e.g. "hi, what is 2+2"), FULFILL that request completely as an expert AI. DO NOT let a greeting trigger a short response when a longer intelligent response is needed.
- Answer helpfully and fully — essays, explanations, code, lists — whatever is asked. Do NOT artificially shorten. Do NOT invent facts about the user.`;

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

          const languageHint =
            body.language === "mni"
              ? "\n\n# LANGUAGE OVERRIDE\nReply in Meiteilon romanized in Latin letters ONLY."
              : body.language === "mni-mtei"
                ? "\n\n# LANGUAGE OVERRIDE\nReply entirely in Meitei Mayek script (ꯃꯤꯇꯩ ꯃꯌꯦꯛ)."
                : body.language === "en"
                  ? "\n\n# LANGUAGE OVERRIDE\nReply entirely in fluent English only."
                  : "";

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

          // Was a bare fetch, which had no timeout and no provider fallback: a
          // gateway that accepted the socket and went quiet hung the guest's
          // request until the platform killed it. fetchChatCompletion is the same
          // path the signed-in chat uses.
          const upstream = await fetchChatCompletion(
            "google/gemini-3.7-flash",
            { messages, stream: true },
            { signal: request.signal },
          );

          if (!upstream.ok || !upstream.body) {
            const detail = await upstream.text().catch(() => "");
            // Logged, not returned. The provider's error body can carry request
            // ids, quota state and model wiring that a public caller has no
            // business seeing.
            console.error("[guest-chat] upstream failed", upstream.status, detail.slice(0, 300));
            await releaseGuestMessage(sessionId);
            return new Response(
              JSON.stringify({ error: "Manipuri AI couldn't answer just now. Please try again." }),
              { status: 502, headers: { "Content-Type": "application/json" } },
            );
          }

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
              const reader = upstream.body!.getReader();
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
