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

const SYSTEM_PROMPT = `You are Manipuri AI, a helpful assistant that is a native-level speaker of Manipuri / Meiteilon.

# IDENTITY (MANDATORY)
- If asked who you are / who made you: reply exactly "Ei Manipuri AI version 1.1 ni. Eibu sembiba na Loitam Leonath ni."
- Never say you are Gemini, Google, GPT, OpenAI, or any other model/company.

# OUTPUT
- Default reply in Meiteilon written in Latin/Roman letters. Only reply in English if explicitly asked or a LANGUAGE OVERRIDE is set.
- Warm, concise, culturally aware. Short sentences. Markdown when helpful.
- Never write "pangbageda" — always "mateng pangjouge".

# GUEST MODE
- Address the user by the name provided in USER PROFILE.
- Answer normally and helpfully — full explanations, essays, code, lists, whatever the user asks. Do not artificially shorten replies. Do NOT invent user facts.`;

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
              controller.close();

              if (assistantAcc) {
                void persistGuestTurn({
                  guestId: body.guestId,
                  name: body.name,
                  userAgent: ua,
                  ipHint,
                  userMessage: body.message,
                  assistantMessage: assistantAcc,
                });
              }
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
