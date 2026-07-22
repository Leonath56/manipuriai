import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { chatCompletionsEndpoint } from "@/lib/ai-provider.server";

const GUEST_FREE_LIMIT = 3;

const BodySchema = z.object({
  name: z.string().trim().min(1).max(60),
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
});

async function persistGuestTurn(opts: {
  guestId: string;
  name: string;
  userAgent: string | null;
  ipHint: string | null;
  userMessage: string;
  assistantMessage: string;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("guest_sessions")
      .select("id, message_count")
      .eq("guest_id", opts.guestId)
      .maybeSingle();

    let sessionId: string;
    if (existing) {
      sessionId = existing.id;
      await supabaseAdmin
        .from("guest_sessions")
        .update({
          name: opts.name,
          message_count: (existing.message_count ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
    } else {
      const { data: created, error } = await supabaseAdmin
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
      if (error || !created) return;
      sessionId = created.id;
    }

    await supabaseAdmin.from("guest_messages").insert([
      { guest_session_id: sessionId, role: "user", content: opts.userMessage },
      { guest_session_id: sessionId, role: "assistant", content: opts.assistantMessage },
    ]);
  } catch {
    // best-effort; never fail the reply because of logging
  }
}

const SYSTEM_PROMPT = `You are Manipuri AI — a NATIVE Meiteilon (Manipuri) speaker from Imphal. This is a first-impression free trial; every reply must sound like a real Manipuri friend, not a translation.

# IDENTITY
- If asked who you are / who made you: reply exactly "Ei Manipuri AI version 1.1 ni. Eibu sembiba na Loitam Leonath ni."
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

# SELF-CHECK BEFORE SENDING
1. Verb at the end of every sentence?
2. Correct case markers glued to nouns?
3. Zero Bengali/Hindi words?
4. Reads like a Manipuri friend's WhatsApp message?

# GUEST MODE
- Answer helpfully and fully — essays, explanations, code, lists — whatever is asked. Do NOT artificially shorten. Do NOT invent facts about the user.`;

export const Route = createFileRoute("/api/public/guest-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
          if (!LOVABLE_API_KEY) return new Response("AI not configured", { status: 500 });

          const body = BodySchema.parse(await request.json());

          // Server-enforced free-trial limit. Do NOT trust any client counter.
          const ua = request.headers.get("user-agent");
          const ipHint =
            request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            null;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Check by guestId
          const { data: existingSession } = await supabaseAdmin
            .from("guest_sessions")
            .select("id, message_count")
            .eq("guest_id", body.guestId)
            .maybeSingle();

          let usedByGuest = existingSession?.message_count ?? 0;

          // Also cap by IP to prevent guestId rotation abuse
          let usedByIp = 0;
          if (ipHint) {
            const { data: ipRows } = await supabaseAdmin
              .from("guest_sessions")
              .select("message_count")
              .eq("ip_hint", ipHint);
            usedByIp = (ipRows ?? []).reduce((s, r) => s + (r.message_count ?? 0), 0);
          }

          const usedMax = Math.max(usedByGuest, usedByIp);
          if (usedMax >= GUEST_FREE_LIMIT) {
            return new Response(
              JSON.stringify({
                error: "Free trial limit reached. Please sign up to continue.",
                limit: GUEST_FREE_LIMIT,
              }),
              { status: 429, headers: { "Content-Type": "application/json" } },
            );
          }

          const languageHint =
            body.language === "mni"
              ? "\n\n# LANGUAGE OVERRIDE\nReply in Meiteilon romanized in Latin letters ONLY."
              : body.language === "mni-mtei"
                ? "\n\n# LANGUAGE OVERRIDE\nReply entirely in Meitei Mayek script (ꯃꯤꯇꯩ ꯃꯌꯦꯛ)."
                : body.language === "en"
                  ? "\n\n# LANGUAGE OVERRIDE\nReply entirely in fluent English only."
                  : "";

          const userInfo = `\n\n# USER PROFILE\n- The user's name is: ${body.name}\n- Address them by name naturally. Never call them "Khullak", "Marup", or a placeholder.`;

          const messages = [
            { role: "system", content: SYSTEM_PROMPT + userInfo + languageHint },
            ...body.history.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: body.message },
          ];

          const ep = chatCompletionsEndpoint("google/gemini-2.5-flash");
          const upstream = await fetch(ep.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${ep.apiKey}`,
            },
            body: JSON.stringify({
              model: ep.model,
              messages,
              stream: true,
            }),
          });

          if (!upstream.ok || !upstream.body) {
            const t = await upstream.text();
            return new Response(
              JSON.stringify({ error: t.slice(0, 300) || "AI request failed" }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          const encoder = new TextEncoder();
          const decoder = new TextDecoder();
          let assistantAcc = "";

          const stream = new ReadableStream({
            async start(controller) {
              let buffer = "";
              const reader = upstream.body!.getReader();
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
                        controller.enqueue(encoder.encode(fixed));
                      }
                    } catch {
                      // ignore
                    }
                  }
                }
              } catch (err) {
                controller.error(err);
                return;
              }

              if (assistantAcc) {
                // Await so the Worker doesn't terminate the persist promise
                // when the response stream closes.
                await persistGuestTurn({
                  guestId: body.guestId,
                  name: body.name,
                  userAgent: ua,
                  ipHint,
                  userMessage: body.message,
                  assistantMessage: assistantAcc,
                });
              }

              controller.close();
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
          const msg = err instanceof Error ? err.message : "Server error";
          return new Response(JSON.stringify({ error: msg }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
