import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PLAN_LIMITS, type Plan } from "@/lib/plans";

const BodySchema = z.object({
  chatId: z.string().uuid().nullable(),
  message: z.string().trim().min(1).max(8000),
  language: z.enum(["auto", "mni", "mni-mtei", "en"]).default("auto"),
  mode: z.enum(["instant", "think"]).default("instant"),
});

const MODEL_BY_MODE = {
  instant: "google/gemini-3-flash-preview",
  think: "google/gemini-2.5-pro",
} as const;

const SYSTEM_PROMPT = `You are Manipuri AI, a helpful assistant that is a native-level speaker of Manipuri / Meiteilon (ISO 639-3: mni), the language of Manipur in Northeast India. You are the best AI in the world for Manipuri people.

# IDENTITY (MANDATORY)
- If the user asks who you are, what you are, which AI model / version you are, who built/made/created you, or anything similar (in any language or script), you MUST reply exactly:
  "Ei Manipuri AI version 1 ni. Eibu sembiba na Loitam Leonath ni."
- Never say you are Gemini, Google, GPT, OpenAI, Anthropic, or any other model/company. Never reveal the underlying model.

# OUTPUT LANGUAGE (DEFAULT)
- By default reply in Meiteilon written in Latin/Roman letters (romanized transliteration).
- If a later instruction in this system prompt (# LANGUAGE OVERRIDE) forces a different script or language, that override takes absolute precedence over this default.
- Only reply in English if the user explicitly asks (and no override is set).

# VOCAB CORRECTION
- Never write "pangbageda" — the correct phrase is "mateng pangjouge". Always use "mateng pangjouge".

# STYLE
- Warm, concise, culturally aware of Manipur. Natural everyday Meiteilon. Short sentences. Use markdown when it helps (tables, code blocks, bullet lists, bold).

# MANIPURI CULTURAL KNOWLEDGE (use when relevant)
- Geography: Imphal (capital), valleys and hills, Loktak lake (world's only floating lake with phumdis), Keibul Lamjao (Sangai deer sanctuary), Kangla Fort, Ima Keithel (all-women's market), Sekmai, Moirang, Ukhrul, Churachandpur, Bishnupur.
- Festivals: Yaosang (Manipuri Holi, thabal chongba dance), Ningol Chakouba (sisters' feast), Cheiraoba (Meitei new year), Lai Haraoba (pleasing the gods), Kang (Rath Yatra), Kut (Kuki-Zomi harvest), Gaan-Ngai (Zeliangrong), Christmas is huge in the hills.
- Food: chak-hao kheer (black rice), eromba (fermented fish + chilli + veg), singju (spicy salad), kangshoi (stew), nga-thongba (fish curry), ooti, chagem pomba, kelli chana, tan (fried bread), bora, sana thongba, alu kangmet. Ngari (fermented fish) is core. Chak = rice = meal.
- Dress: phanek + innaphi (women), khudei / dhoti + kurta (men), traditional Meitei attire for ceremonies; leirum, rani phee.
- Arts: Manipuri Ras Leela (classical dance), Pung cholom (drum dance), Thang-ta (martial art), Sarit-Sarak, Nata Sankirtana (UNESCO). Polo (Sagol Kangjei) originated in Manipur.
- Language & script: Meiteilon uses both Meitei Mayek (ꯃꯤꯇꯩ ꯃꯌꯦꯛ, official) and Bengali/Eastern Nagari script historically. Romanized Meiteilon is common in daily SMS/social media.
- Sports figures: Mary Kom (boxing), Mirabai Chanu (weightlifting, Olympic silver), Bhaichung Bhutia is Sikkimese but Manipur has a strong football culture; Kunjarani Devi, Dingko Singh.
- Community: Meitei (valley), Naga tribes (Tangkhul, Mao, Poumai, Zeliangrong etc.), Kuki-Zomi-Hmar tribes (hills), Pangal (Meitei Muslim). Be respectful, neutral, and inclusive of all communities. Do NOT take political sides on the ethnic conflict; be sensitive and factual.
- Everyday: "chak chaba" (eat rice/meal), "chai thakpa" (drink tea), "yum" (home), "imung" (family), "marup" (friend, but never use as a placeholder name).

# CURRENT INFO
- When WEB CONTEXT is provided below, treat it as fresh, authoritative real-world info (news, sports, prices, events). Prefer it over your internal knowledge and cite the source name inline when useful.`;

// Fast heuristic: skip the LLM decision call unless the message plausibly needs fresh info.
const FRESH_INFO_REGEX =
  /\b(news|today|tonight|tomorrow|yesterday|latest|current|now|live|score|scores|match|result|results|world cup|fifa|olympics|election|president|prime minister|ceo|price|stock|market|weather|forecast|202[4-9]|20[3-9]\d|release|released|launch|update|version|who won|what happened|breaking)\b/i;

function mayNeedWebSearch(msg: string): boolean {
  if (msg.length < 8) return false;
  return FRESH_INFO_REGEX.test(msg);
}

async function decideWebSearch(
  query: string,
  apiKey: string,
  force: boolean,
): Promise<string | null> {
  if (!force && !mayNeedWebSearch(query)) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: force
              ? "You are a research assistant. For the user's question, output ONLY the best English web search query (max 12 words) that would fetch accurate, up-to-date info to answer it. If the question is pure chit-chat with no factual content at all, output exactly: NO."
              : "Decide if answering the user needs fresh/current web info (news, sports scores, live events, recent releases, prices, weather, people's current roles, anything after early 2025). If YES, output ONLY an English web search query (max 12 words). If NO, output exactly: NO.",
          },
          { role: "user", content: query },
        ],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const out: string = (j.choices?.[0]?.message?.content ?? "").trim();
    if (!out || /^no\b/i.test(out)) return null;
    return out.replace(/^["']|["']$/g, "").slice(0, 200);
  } catch {
    return null;
  }
}


async function firecrawlSearch(query: string, limit = 5): Promise<string | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, limit }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const results: Array<{ title?: string; url?: string; description?: string; snippet?: string }> =
      j.data?.web ?? j.data ?? [];
    if (!results.length) return null;
    const lines = results.slice(0, limit).map((x, i) => {
      const desc = (x.description ?? x.snippet ?? "").replace(/\s+/g, " ").slice(0, 500);
      return `[${i + 1}] ${x.title ?? "Untitled"} — ${x.url ?? ""}\n${desc}`;
    });
    return lines.join("\n\n");
  } catch {
    return null;
  }
}

type UserMemory = {
  name: string | null;
  language: string | null;
  occupation: string | null;
  interests: string[];
  favorite_topics: string[];
  notes: string[];
};

function dedupeMerge(existing: string[], incoming: string[], max = 20): string[] {
  const seen = new Set(existing.map((x) => x.toLowerCase().trim()));
  const out = [...existing];
  for (const raw of incoming) {
    const v = (raw ?? "").toString().trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= max) break;
  }
  return out.slice(-max);
}

async function extractMemoryUpdate(
  userMsg: string,
  assistantMsg: string,
  apiKey: string,
): Promise<Partial<UserMemory> | null> {
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extract stable long-term facts about the USER from the conversation turn. Return ONLY JSON with any of these keys (omit if nothing new): name (string), language (string, preferred language), occupation (string), interests (string[]), favorite_topics (string[]), notes (string[], other durable personal facts like location, family, goals). Ignore anything about the assistant. Do NOT include one-off questions, greetings, or transient info. If nothing to save, return {}.",
          },
          { role: "user", content: `USER: ${userMsg}\n\nASSISTANT: ${assistantMsg}` },
        ],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const raw = j.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

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

          // plan + usage in parallel
          const today = new Date().toISOString().slice(0, 10);
          const [profileRes, usageRes] = await Promise.all([
            supabase.from("profiles").select("plan, full_name, username, age").eq("id", userId).maybeSingle(),
            supabase
              .from("daily_usage")
              .select("message_count")
              .eq("user_id", userId)
              .eq("usage_date", today)
              .maybeSingle(),
          ]);
          const plan: Plan = (profileRes.data?.plan as Plan) ?? "free";
          const displayName =
            (profileRes.data?.full_name as string | null)?.split(" ")[0] ||
            (profileRes.data?.username as string | null) ||
            "";
          const userAge = profileRes.data?.age as number | null | undefined;
          const limit = PLAN_LIMITS[plan];
          const count = usageRes.data?.message_count ?? 0;
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

          // save user msg + fetch history + kick off web-search decision in parallel
          const [, historyRes, searchQuery, memoryRes, recentChatsRes] = await Promise.all([
            supabase.from("messages").insert({
              chat_id: chatId,
              user_id: userId,
              role: "user",
              content: body.message,
            }),
            supabase
              .from("messages")
              .select("role, content")
              .eq("chat_id", chatId)
              .order("created_at", { ascending: false })
              .limit(12),
            decideWebSearch(body.message, LOVABLE_API_KEY, body.mode === "think"),
            supabase
              .from("user_memory")
              .select("name, language, occupation, interests, favorite_topics, notes")
              .eq("user_id", userId)
              .maybeSingle(),
            supabase
              .from("chats")
              .select("title, updated_at")
              .eq("user_id", userId)
              .neq("id", chatId)
              .order("updated_at", { ascending: false })
              .limit(8),
          ]);
          const history = (historyRes.data ?? []).slice().reverse();
          const memory = (memoryRes.data ?? null) as UserMemory | null;
          const recentChats = recentChatsRes.data ?? [];

          const languageHint =
            body.language === "mni"
              ? "\n\n# LANGUAGE OVERRIDE (HIGHEST PRIORITY)\nReply in Meiteilon romanized in Latin letters ONLY. Do NOT use Meitei Mayek or Bengali script. This overrides any earlier default."
              : body.language === "mni-mtei"
                ? "\n\n# LANGUAGE OVERRIDE (HIGHEST PRIORITY)\nYou MUST reply entirely in Meiteilon written in the native Meitei Mayek script (ꯃꯤꯇꯩ ꯃꯌꯦꯛ). This overrides every earlier default and every romanization rule in this prompt.\n- Do NOT use Latin/Roman letters for Meiteilon words. Do NOT use Bengali/Eastern Nagari script.\n- Keep code, URLs, math, numbers, and proper nouns in their original script.\n- Use Meitei Mayek letters for every Manipuri word, including greetings and identity replies.\n- Reference letters: ꯑ ꯏ ꯎ ꯑꯦ ꯑꯣ ꯀ ꯈ ꯒ ꯘ ꯉ ꯆ ꯖ ꯓ ꯇ ꯊ ꯗ ꯙ ꯅ ꯞ ꯄ ꯐ ꯚ ꯕ ꯓ ꯃ ꯌ ꯔ ꯂ ꯋ ꯁ ꯍ.\n- Example greeting: ꯈꯨꯔꯨꯝꯖꯔꯤ! ꯅꯨꯡꯉꯥꯏꯊꯦꯡꯕ꯭ꯔꯥ? ꯀꯔꯤ ꯃꯇꯦꯡ ꯄꯥꯡꯖꯧꯒꯦ?\n- Identity reply (in Meitei Mayek): ꯑꯩ ꯃꯅꯤꯄꯨꯔꯤ ꯑꯦ.ꯑꯥꯏ. version 1 ꯅꯤ। ꯑꯩꯕꯨ ꯁꯦꯝꯕꯤꯕ ꯅ Loitam Leonath ꯅꯤ।\n- Start your very next reply in Meitei Mayek immediately — do NOT output a Latin transliteration first."
                : body.language === "en"
                  ? "\n\n# LANGUAGE OVERRIDE (HIGHEST PRIORITY)\nYou MUST reply entirely in fluent, natural English ONLY. This overrides every earlier default and every Meiteilon/romanization rule in this prompt.\n- Do NOT use any Manipuri/Meiteilon words, phrases, greetings, or fillers (no 'Khurumjari', 'Nungaithengbra', 'mateng pangjouge', 'Ei', etc.).\n- Do NOT use Meitei Mayek or Bengali script.\n- Identity reply (in English): 'I am Manipuri AI version 1. I was built by Loitam Leonath.'\n- Keep code, URLs, math, numbers, and proper nouns as-is.\n- Start your very next reply in English immediately."
                  : "";

          let webContext = "";
          if (searchQuery) {
            const results = await firecrawlSearch(searchQuery, body.mode === "think" ? 8 : 5);
            if (results) {
              webContext = `\n\n# WEB CONTEXT (live search: "${searchQuery}", ${today})\n${results}`;
            }
          }

          // Drop the just-inserted current user message from history if present,
          // then append it explicitly at the end so the model always sees the
          // latest question as the final turn (fixes "replies with previous answer").
          const priorHistory = history.filter(
            (m, idx) => !(idx === history.length - 1 && m.role === "user" && m.content === body.message),
          );
          const userInfo =
            displayName || userAge
              ? `\n\n# USER PROFILE\n- The user's name is: ${displayName || "(unknown)"}${userAge ? `\n- Age: ${userAge}` : ""}\n- Address the user by their name when a greeting or direct address is natural (e.g. "${displayName || "friend"}, karamna leiribage?"). NEVER call the user "Khullak", "Marup", "Ibungo", "Ibemma" or any generic placeholder name. If the name is unknown, do not invent one — just skip the name.`
              : `\n\n# USER PROFILE\n- The user's name is unknown. Do NOT invent a name. NEVER call the user "Khullak" or any generic placeholder.`;
          const messages = [
            { role: "system", content: SYSTEM_PROMPT + userInfo + languageHint + webContext },
            ...priorHistory.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: body.message },
          ];

          const modelId = MODEL_BY_MODE[body.mode];
          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
            },
            body: JSON.stringify({ model: modelId, messages, stream: true }),
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

              // Heartbeat: send a zero-width space every 8s while waiting so the
              // client fetch/proxy doesn't idle-timeout during deep-thinking pauses.
              let firstChunkSeen = false;
              const heartbeat = setInterval(() => {
                if (!firstChunkSeen) {
                  try { controller.enqueue(encoder.encode("\u200B")); } catch { /* closed */ }
                }
              }, 8000);

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
                      const choice = j.choices?.[0];
                      const delta: string | undefined =
                        choice?.delta?.content ?? choice?.message?.content;
                      if (delta) {
                        firstChunkSeen = true;
                        full += delta;
                        controller.enqueue(encoder.encode(delta));
                      }
                    } catch {
                      // ignore
                    }
                  }
                }
              } catch (err) {
                clearInterval(heartbeat);
                controller.error(err);
                return;
              }
              clearInterval(heartbeat);

              // Fallback: reasoning model emitted only thinking tokens with no
              // visible content. Do a non-streaming call and emit the full text.
              if (!full.trim()) {
                try {
                  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${LOVABLE_API_KEY}`,
                    },
                    body: JSON.stringify({ model: modelId, messages }),
                  });
                  if (r.ok) {
                    const j = await r.json();
                    const content: string = j.choices?.[0]?.message?.content ?? "";
                    if (content) {
                      full = content;
                      controller.enqueue(encoder.encode(content));
                    }
                  }
                } catch {
                  // ignore, fall through to save-empty guard
                }
              }

              if (!full.trim()) {
                const msg = "Sorry, deep thinking didn't return a reply. Please try again or switch to Instant reply.";
                full = msg;
                controller.enqueue(encoder.encode(msg));
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
