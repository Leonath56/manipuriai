import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { chatCompletionsEndpoint } from "@/lib/ai-provider.server";

const BodySchema = z.object({
  chatId: z.string().uuid().nullable(),
  prompt: z.string().trim().min(1).max(2000),
  aspectRatio: z.enum(["1:1", "16:9", "9:16"]).default("1:1"),
  quality: z.enum(["standard", "hd"]).default("standard"),
  count: z.number().int().min(1).max(4).default(1),
  style: z
    .enum(["realistic", "anime", "digital-art", "oil-painting", "3d-render", "pixel-art", "watercolor", "none"])
    .default("none"),
});

const STYLE_SUFFIX: Record<string, string> = {
  realistic: ", photorealistic, hyper-detailed, professional photography, sharp focus, natural lighting",
  anime: ", anime style, cel-shaded, vibrant colors, studio-quality anime illustration",
  "digital-art": ", digital art, concept art, trending on artstation, highly detailed",
  "oil-painting": ", oil painting, thick brush strokes, classical fine art, museum quality",
  "3d-render": ", 3D render, octane render, unreal engine 5, physically based rendering, ultra-detailed",
  "pixel-art": ", pixel art, 16-bit retro game style, crisp pixels",
  watercolor: ", watercolor painting, soft washes, delicate brushwork, artistic",
  none: "",
};

function sizeFor(aspect: "1:1" | "16:9" | "9:16") {
  if (aspect === "16:9") return "1536x1024";
  if (aspect === "9:16") return "1024x1536";
  return "1024x1024";
}

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
          if (!token) return new Response("Unauthorized", { status: 401 });

          const body = BodySchema.parse(await request.json());
          const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
          const SUPABASE_URL = process.env.SUPABASE_URL;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
            return new Response("Server misconfigured", { status: 500 });
          }

          const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data: userRes, error: userErr } = await supabase.auth.getUser();
          if (userErr || !userRes.user) return new Response("Unauthorized", { status: 401 });
          const userId = userRes.user.id;

          // Paid feature: image generation is Pro/Max only.
          const { data: profile } = await supabase
            .from("profiles")
            .select("plan")
            .eq("id", userId)
            .maybeSingle();
          const plan = (profile?.plan as string | undefined) ?? "free";
          if (plan !== "pro" && plan !== "max") {
            return new Response(
              JSON.stringify({ error: "Image generation is a Pro feature. Upgrade your plan to unlock it." }),
              { status: 402, headers: { "Content-Type": "application/json" } },
            );
          }

          // Translate/expand the prompt to a rich, descriptive English prompt.
          // This fixes two problems:
              //  1. Manipuri/Meiteilon prompts were being sent to the image model raw,
              //     which the model couldn't understand → produced generic scenery.
              //  2. Vague English prompts ("a monkey with banana") get expanded with
              //     concrete visual detail so the model doesn't drift.
          let translatedPrompt = body.prompt;
          try {
            const trEp = chatCompletionsEndpoint("google/gemini-2.5-flash");
            const tr = await fetch(trEp.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${trEp.apiKey}`,
              },
              body: JSON.stringify({
                model: trEp.model,
                messages: [
                  {
                    role: "system",
                    content:
                      "You convert any user request (which may be in Manipuri/Meiteilon romanized, Meitei Mayek, or English) into ONE concise English image-generation prompt. " +
                      "Rules: (1) Output ONLY the final English prompt, no quotes, no preface, no explanation. " +
                      "(2) Preserve every concrete subject, object, action, count, color, and setting the user mentioned — do not substitute. " +
                      "(3) Add helpful visual detail (composition, lighting, environment) but never change the subject. " +
                      "(4) Keep it under 80 words.",
                  },
                  { role: "user", content: body.prompt },
                ],
              }),
            });
            if (tr.ok) {
              const tj = await tr.json();
              const out: string | undefined = tj?.choices?.[0]?.message?.content;
              if (out && out.trim()) translatedPrompt = out.trim().replace(/^["']|["']$/g, "");
            }
          } catch {
            // fall back to raw prompt
          }

          // Enriched prompt
          const enriched = translatedPrompt + (STYLE_SUFFIX[body.style] ?? "");
          const size = sizeFor(body.aspectRatio);
          const quality = body.quality === "hd" ? "high" : "medium";

          // Fire N image requests in parallel
          const tasks = Array.from({ length: body.count }).map(async () => {
            const r = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
              },
              body: JSON.stringify({
                model: "openai/gpt-image-2",
                prompt: enriched,
                size,
                quality,
                n: 1,
              }),
            });
            if (!r.ok) {
              const t = await r.text().catch(() => "");
              throw new Error(`Image API ${r.status}: ${t.slice(0, 200)}`);
            }
            const j = await r.json();
            const b64: string | undefined = j?.data?.[0]?.b64_json;
            if (!b64) throw new Error("No image returned");
            return `data:image/png;base64,${b64}`;
          });

          let dataUrls: string[];
          try {
            dataUrls = await Promise.all(tasks);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Image generation failed";
            const isRate = /\b429\b/.test(msg);
            const isCredits = /\b402\b/.test(msg);
            return new Response(
              isRate
                ? "Rate limit reached. Please try again in a moment."
                : isCredits
                  ? "AI credits exhausted. Please add credits in the workspace."
                  : msg,
              { status: isRate ? 429 : isCredits ? 402 : 500 },
            );
          }

          // Ensure chat exists
          let chatId = body.chatId;
          if (!chatId) {
            const title = body.prompt.slice(0, 60);
            const { data: chat, error: chatErr } = await supabase
              .from("chats")
              .insert({ user_id: userId, title, kind: "image" })
              .select("id")
              .single();
            if (chatErr || !chat) return new Response("Failed to create chat", { status: 500 });
            chatId = chat.id;
          }

          // Store metadata in assistant message so the client can render controls.
          // Format: fenced JSON block + markdown images for graceful fallback.
          const meta = {
            kind: "image",
            prompt: body.prompt,
            aspectRatio: body.aspectRatio,
            quality: body.quality,
            style: body.style,
            images: dataUrls,
          };
          const assistantContent =
            "```image-generation\n" +
            JSON.stringify(meta) +
            "\n```\n" +
            dataUrls.map((u) => `![${body.prompt}](${u})`).join("\n");

          const nowIso = new Date().toISOString();
          const { error: insertErr } = await supabase.from("messages").insert([
            { chat_id: chatId, user_id: userId, role: "user", content: body.prompt },
            { chat_id: chatId, user_id: userId, role: "assistant", content: assistantContent },
          ]);
          if (insertErr) return new Response("Failed to save messages", { status: 500 });

          await supabase.from("chats").update({ updated_at: nowIso }).eq("id", chatId);

          // Update daily_usage (best-effort)
          const today = nowIso.slice(0, 10);
          const { data: usage } = await supabase
            .from("daily_usage")
            .select("message_count")
            .eq("user_id", userId)
            .eq("usage_date", today)
            .maybeSingle();
          await supabase.from("daily_usage").upsert(
            {
              user_id: userId,
              usage_date: today,
              message_count: (usage?.message_count ?? 0) + 1,
              updated_at: nowIso,
            },
            { onConflict: "user_id,usage_date" },
          );

          return Response.json({ chatId, images: dataUrls });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          return new Response(msg, { status: 400 });
        }
      },
    },
  },
});
