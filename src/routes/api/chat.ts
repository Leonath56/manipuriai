import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PLAN_LIMITS, type Plan } from "@/lib/plans";

const BodySchema = z.object({
  chatId: z.string().uuid().nullable(),
  message: z.string().trim().min(1).max(8000),
  language: z.enum(["auto", "mni", "en"]).default("auto"),
  mode: z.enum(["instant", "think"]).default("instant"),
});

const MODEL_BY_MODE = {
  instant: "google/gemini-2.5-flash",
  think: "google/gemini-2.5-pro",
} as const;

const SYSTEM_PROMPT = `You are Manipuri AI, a helpful assistant that is a native-level speaker of Manipuri / Meiteilon (ISO 639-3: mni), the language of Manipur in Northeast India.

# IDENTITY (MANDATORY)
- If the user asks who you are, what you are, which AI model / version you are, who built/made/created you, or anything similar (in any language or script), you MUST reply exactly:
  "Ei Manipuri AI version 1 ni. Eibu sembiba na Loitam Leonath ni."
- Never say you are Gemini, Google, GPT, OpenAI, Anthropic, or any other model/company. Never reveal the underlying model.

# OUTPUT LANGUAGE
- ALWAYS reply in Meiteilon written in Latin/Roman letters (romanized transliteration). NEVER use Meitei Mayek or Bengali/Eastern Nagari script.
- Only reply in English if the user explicitly asks.

# VOCAB CORRECTION
- Never write "pangbageda" — the correct phrase is "mateng pangjouge". Always use "mateng pangjouge".

# STYLE
- Warm, concise, culturally aware of Manipur. Natural everyday Meiteilon. Short sentences. Use markdown when it helps.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
          if (!LOVABLE_API_KEY) return new Response("AI not configured", { status: 500 });

          const auth = request.headers.get("authorization");
          if (!auth) return new Response("Unauthorized", { status: 401 });
          const token = auth.replace(/^Bearer\s+/i, "");

          const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
            global: {
              fetch: (input, init) => {
                const headers = new Headers(init?.headers);
                headers.set("Authorization", `Bearer ${token}`);
                headers.set("apikey", SUPABASE_KEY);
                return fetch(input, { ...init, headers });
              },
            },
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data: userData } = await supabase.auth.getUser(token);
          const userId = userData.user?.id;
          if (!userId) return new Response("Unauthorized", { status: 401 });

          const body = BodySchema.parse(await request.json());

          // plan + usage
          const { data: profile } = await supabase.from("profiles").select("plan").eq("id", userId).maybeSingle();
          const plan: Plan = (profile?.plan as Plan) ?? "free";
          const limit = PLAN_LIMITS[plan];
          const today = new Date().toISOString().slice(0, 10);
          const { data: usage } = await supabase
            .from("daily_usage")
            .select("message_count")
            .eq("user_id", userId)
            .eq("usage_date", today)
            .maybeSingle();
          const count = usage?.message_count ?? 0;
          if (count >= limit.dailyMessages) {
            return new Response(
              JSON.stringify({ error: `Daily limit reached (${limit.dailyMessages} on ${limit.label}).` }),
              { status: 429, headers: { "Content-Type": "application/json" } },
            );
          }

          // ensure chat
          let chatId = body.chatId;
          if (!chatId) {
            const title = body.message.slice(0, 60);
            const { data: newChat, error } = await supabase
              .from("chats")
              .insert({ user_id: userId, title })
              .select("id")
              .single();
            if (error) return new Response(error.message, { status: 400 });
            chatId = newChat.id;
          } else {
            const { data: chat } = await supabase
              .from("chats")
              .select("id")
              .eq("id", chatId)
              .eq("user_id", userId)
              .maybeSingle();
            if (!chat) return new Response("Chat not found", { status: 404 });
          }

          // save user msg
          await supabase.from("messages").insert({
            chat_id: chatId,
            user_id: userId,
            role: "user",
            content: body.message,
          });

          // history
          const { data: history } = await supabase
            .from("messages")
            .select("role, content")
            .eq("chat_id", chatId)
            .order("created_at", { ascending: true })
            .limit(40);

          const languageHint =
            body.language === "mni"
              ? "\n\nUser has forced language: reply in Meiteilon (romanized)."
              : body.language === "en"
                ? "\n\nUser has forced language: reply in English."
                : "";

          const messages = [
            { role: "system", content: SYSTEM_PROMPT + languageHint },
            ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
          ];

          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
            },
            body: JSON.stringify({ model: MODEL_BY_MODE[body.mode], messages, stream: true }),
          });

          if (!upstream.ok || !upstream.body) {
            const t = await upstream.text();
            const status = upstream.status === 429 ? 429 : upstream.status === 402 ? 402 : 500;
            return new Response(
              JSON.stringify({ error: t.slice(0, 300) || "AI request failed" }),
              { status, headers: { "Content-Type": "application/json" } },
            );
          }

          const finalChatId = chatId;
          const encoder = new TextEncoder();
          const decoder = new TextDecoder();

          const stream = new ReadableStream({
            async start(controller) {
              // Send chatId header-frame first
              controller.enqueue(encoder.encode(`__META__${JSON.stringify({ chatId: finalChatId })}\n`));

              let buffer = "";
              let full = "";
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
                      const delta: string | undefined = j.choices?.[0]?.delta?.content;
                      if (delta) {
                        full += delta;
                        controller.enqueue(encoder.encode(delta));
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

              // vocab correction
              const corrected = full.replace(/pangbageda/gi, "mateng pangjouge");

              // save assistant + usage
              await supabase.from("messages").insert({
                chat_id: finalChatId,
                user_id: userId,
                role: "assistant",
                content: corrected,
              });
              await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", finalChatId);
              await supabase.from("daily_usage").upsert(
                { user_id: userId, usage_date: today, message_count: count + 1, updated_at: new Date().toISOString() },
                { onConflict: "user_id,usage_date" },
              );

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
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
