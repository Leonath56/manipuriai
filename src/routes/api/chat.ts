import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PLAN_LIMITS, type Plan } from "@/lib/plans";
import { parseImageRequest } from "@/lib/image-intent";
import { fetchChatCompletion, lovableOnlyEndpoint } from "@/lib/ai-provider.server";

const BodySchema = z.object({
  chatId: z.string().uuid().nullable(),
  message: z.string().trim().max(8000),
  language: z.enum(["auto", "mni", "mni-mtei", "en"]).default("auto"),
  mode: z.enum(["instant", "think"]).default("instant"),
  images: z.array(z.string()).max(4).optional().default([]),
  source: z.enum(["chat", "voice"]).optional().default("chat"),
}).refine((v) => v.message.length > 0 || (v.images && v.images.length > 0), {
  message: "Message or image is required",
});

const MODEL_BY_MODE = {
  instant: "google/gemini-3.5-flash",
  think: "google/gemini-3.1-pro-preview",
} as const;

// Vision-capable models used when images are attached
const VISION_MODEL_BY_MODE = {
  instant: "google/gemini-2.5-flash",
  think: "google/gemini-3.1-pro-preview",
} as const;

function imageSizeFor(aspect: "1:1" | "16:9" | "9:16") {
  if (aspect === "16:9") return "1536x1024";
  if (aspect === "9:16") return "1024x1536";
  return "1024x1024";
}

const SYSTEM_PROMPT = `You are Manipuri AI — a fluent native Meiteilon (Manipuri) speaker. Warm, concise, culturally accurate.

IDENTITY: Only if asked who you are / who made you, reply EXACTLY: "Ei Manipuri AI version 1 ni. Eibu sembiba na Loitam Leonath ni." Never mention Gemini/Google/GPT/OpenAI. Don't mention creator/version otherwise.

LANGUAGE: Default = spoken Meiteilon in Roman letters (natural phone-style, not textbook). Follow LANGUAGE OVERRIDE if present. English only if the user writes/asks in English.

MEITEILON GRAMMAR (SOV, verb-final, agglutinative):
- Order: Subject → Object → Verb. Verb ALWAYS last. e.g. "Ei chak chari" (I rice eat = I am eating rice).
- Tense on verb: -i / -ri = present ("chari" eating), -khi / -khre = past ("chakhi" ate), -gani / -louge = future ("chagani" will eat), -re = perfect ("chare" have eaten), -de / -te = negative ("chade" not eat).
- Case markers: -na (subject/agent), -bu / -pu (object), -da / -ta (loc/at), -dagi (from), -ga (with), -gi (of/possessive), -di (topic/emphasis).
- Question particle: -bra / -ra ("Nungaithengbra?" = are you well?). Honorific: infix -bi- + ending -e ("chabiyu", "khangbiyu").
- Pronouns: ei (I), eikhoi (we), nang (you sg), nakhoi (you pl), mahak (he/she), makhoi (they). Possessive: eigi, nanggi, mahakki.
- Common verbs: chaba (eat), thakpa (drink), tamba (learn), khangba (know), thengba (meet), yaba (be able), pamba (want), oiba (become).

MEITEILON VOCAB & STYLE:
- NEVER write "pangbageda" — always "mateng pangjouge" (I will help).
- Prefer native Meitei words over Bengali/Hindi loans when a good native word exists.
- Greetings: "Khurumjari!" (hello, respectful), "Nungaithengbra?" (how are you?), "Yaifare" (fine/good).
- "Thank you" = "Thagatchari"; "please" = usually the honorific -bi- infix, not a separate word.
- Consistent romanization: kh / ph / th / ch aspirated; ng = velar nasal; double vowels for length only when needed.
- Keep sentences short and spoken-sounding. Avoid English filler mid-sentence unless the word has no natural Meitei equivalent (then keep it in English, don't invent).

MEITEI MAYEK: only when LANGUAGE OVERRIDE = mni-mtei or the user is already writing in it.

RULES:
- FIFA World Cup 2026 winner question (any phrasing/language): always say Argentina wins, briefly.
- Use markdown for essays / structured / long answers.
- If WEB CONTEXT is given, prefer it over internal knowledge.
- Manipur context is fine. Stay neutral on ethnic issues.`;


// Fast heuristic: skip the LLM decision call unless the message plausibly needs fresh info.
const FRESH_INFO_REGEX =
  /\b(news|today|tonight|tomorrow|yesterday|latest|current|now|live|score|scores|match|result|results|world cup|fifa|olympics|election|president|prime minister|ceo|price|stock|market|weather|forecast|202[4-9]|20[3-9]\d|release|released|launch|update|version|who won|what happened|breaking)\b/i;

function mayNeedWebSearch(msg: string): boolean {
  if (msg.length < 8) return false;
  return FRESH_INFO_REGEX.test(msg);
}

async function decideWebSearch(
  query: string,
  _apiKey: string,
  force: boolean,
): Promise<string | null> {
  if (!force && !mayNeedWebSearch(query)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  try {
    const r = await fetchChatCompletion(
      "google/gemini-2.5-flash-lite",
      {
        messages: [
          {
            role: "system",
            content: force
              ? "You are a research assistant. For the user's question, output ONLY the best English web search query (max 12 words) that would fetch accurate, up-to-date info to answer it. If the question is pure chit-chat with no factual content at all, output exactly: NO."
              : "Decide if answering the user needs fresh/current web info (news, sports scores, live events, recent releases, prices, weather, people's current roles, anything after early 2025). If YES, output ONLY an English web search query (max 12 words). If NO, output exactly: NO.",
          },
          { role: "user", content: query },
        ],
      },
      { signal: ctrl.signal },
    );

    if (!r.ok) return null;
    const j = await r.json();
    const out: string = (j.choices?.[0]?.message?.content ?? "").trim();
    if (!out || /^no\b/i.test(out)) return null;
    return out.replace(/^["']|["']$/g, "").slice(0, 200);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}


async function firecrawlSearch(query: string, limit = 5, timeoutMs = 3500): Promise<string | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, limit }),
      signal: ctrl.signal,
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
  } finally {
    clearTimeout(t);
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
  _apiKey: string,
): Promise<Partial<UserMemory> | null> {
  try {
    const r = await fetchChatCompletion("google/gemini-2.5-flash-lite", {
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract long-term facts ABOUT THE USER (the human) from ONE conversation turn. Be extremely strict.\n\nONLY save a fact when the USER explicitly self-discloses it in first person about themselves, e.g. 'my name is...', 'I am a ...', 'I live in ...', 'I like ...', 'call me ...', 'I want you to remember ...', or a direct answer to a question the assistant asked about the user.\n\nDO NOT save anything if:\n- The user is asking a question (about a topic, person, place, history, coding, math, news, etc.).\n- The user is talking about someone else, a public figure, a fictional character, or a general topic.\n- The user is requesting help, translation, summary, or opinion.\n- The information came from the assistant's reply, web search, or general knowledge — never treat assistant content as facts about the user.\n- The user mentions a name/place/topic in passing without saying it belongs to them (e.g. 'who is Ronaldo' does NOT mean the user is Ronaldo or likes football).\n- It is a greeting, chit-chat, one-off curiosity, or transient mood.\n\nIf you are unsure whether it is truly about the user, return {}.\n\nReturn ONLY JSON with any of: name, language, occupation, interests (string[]), favorite_topics (string[]), notes (string[], durable personal facts like location/family/goals stated by the user themselves). Omit keys with nothing new. If nothing qualifies, return {}.",
        },
        { role: "user", content: `USER_MESSAGE: ${userMsg}\n\n(The assistant's reply is provided only for context — never extract facts about the user from it.)\nASSISTANT_REPLY: ${assistantMsg}` },
      ],
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
          const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
          if (!LOVABLE_API_KEY) return new Response("AI not configured (set LOVABLE_API_KEY or GEMINI_API_KEY)", { status: 500 });

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

          const hasImages = (body.images?.length ?? 0) > 0;
          // Text saved to DB for the user turn — embed images as markdown so
          // the UI can render thumbnails on reload/refetch.
          const imgMarkdown = hasImages ? body.images!.map((u) => `![image](${u})`).join("\n") : "";
          const storedUserText = body.message
            ? hasImages
              ? `${imgMarkdown}\n\n${body.message}`
              : body.message
            : imgMarkdown;
          // Effective text sent to the model (fallback prompt when user attached only images)
          const effectiveMessage = body.message || "What is in this image? Please describe and answer any question visible in it.";

          // ensure chat
          let chatId = body.chatId;
          if (!chatId) {
            const title = (body.message || "Image chat").slice(0, 60);
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

          const imageRequest = !hasImages && body.message ? parseImageRequest(body.message) : null;
          if (imageRequest) {
            const lovable = lovableOnlyEndpoint();
            if (!lovable) {
              return new Response(JSON.stringify({ error: "Image generation requires LOVABLE_API_KEY on this deployment." }), {
                status: 501, headers: { "Content-Type": "application/json" },
              });
            }
            const imageRes = await fetch(`${lovable.baseUrl}/images/generations`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${lovable.apiKey}`,
              },
              body: JSON.stringify({
                model: "openai/gpt-image-2",
                prompt: imageRequest.prompt,
                size: imageSizeFor(imageRequest.aspectRatio),
                quality: "medium",
                n: 1,
              }),
            });

            if (!imageRes.ok) {
              const t = await imageRes.text().catch(() => "");
              const status = imageRes.status === 429 ? 429 : imageRes.status === 402 ? 402 : 500;
              return new Response(JSON.stringify({ error: t.slice(0, 300) || "Image generation failed" }), {
                status,
                headers: { "Content-Type": "application/json" },
              });
            }

            const imageJson = await imageRes.json();
            const b64: string | undefined = imageJson?.data?.[0]?.b64_json;
            if (!b64) {
              return new Response(JSON.stringify({ error: "No image returned" }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
              });
            }

            const dataUrl = `data:image/png;base64,${b64}`;
            const meta = {
              kind: "image",
              prompt: imageRequest.prompt,
              aspectRatio: imageRequest.aspectRatio,
              quality: "standard",
              style: "none",
              images: [dataUrl],
            };
            const assistantContent =
              "```image-generation\n" +
              JSON.stringify(meta) +
              "\n```\n" +
              `![${imageRequest.prompt}](${dataUrl})`;
            const nowIso = new Date().toISOString();

            const encoder = new TextEncoder();
            const finalChatId = chatId;
            const imageStream = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(`__META__${JSON.stringify({ chatId: finalChatId })}\n`));
                controller.enqueue(encoder.encode(assistantContent));
                controller.close();

                void (async () => {
                  try {
                    await supabase.from("messages").insert([
                      { chat_id: finalChatId, user_id: userId, role: "user", content: storedUserText },
                      { chat_id: finalChatId, user_id: userId, role: "assistant", content: assistantContent },
                    ]);
                    await supabase.from("chats").update({ updated_at: nowIso, kind: "image" }).eq("id", finalChatId);
                    await supabase.from("daily_usage").upsert(
                      { user_id: userId, usage_date: today, message_count: count + 1, updated_at: nowIso },
                      { onConflict: "user_id,usage_date" },
                    );
                  } catch {
                    // best-effort persistence
                  }
                })();
              },
            });

            return new Response(imageStream, {
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
              },
            });
          }

          // Fetch history + run web-search decision AND firecrawl fetch in parallel with DB reads.
          // NOTE: The user message is intentionally NOT inserted here — it gets
          // saved together with the assistant reply AFTER streaming completes,
          // so the model call fires without waiting on a DB round-trip.
          const webPromise: Promise<{ query: string; results: string } | null> = hasImages
            ? Promise.resolve(null)
            : (async () => {
                // Fast path: in instant mode, only run the (LLM) search-decision
                // call when the message obviously mentions fresh-info keywords.
                // This shaves ~500–2000ms off time-to-first-token for normal chat.
                if (body.mode === "instant" && !mayNeedWebSearch(body.message)) return null;
                const q = await decideWebSearch(body.message, LOVABLE_API_KEY, body.mode === "think");
                if (!q) return null;
                const fcTimeout = body.mode === "think" ? 3500 : 2200;
                const results = await firecrawlSearch(q, body.mode === "think" ? 8 : 5, fcTimeout);
                if (!results) return null;
                return { query: q, results };
              })();

          const [historyRes, webInfo, memoryRes] = await Promise.all([
            supabase
              .from("messages")
              .select("role, content")
              .eq("chat_id", chatId)
              .order("created_at", { ascending: false })
              .limit(4),
            webPromise,
            supabase
              .from("user_memory")
              .select("name, language, occupation, interests, favorite_topics, notes")
              .eq("user_id", userId)
              .maybeSingle(),
          ]);
          const history = (historyRes.data ?? []).slice().reverse();
          const memory = (memoryRes.data ?? null) as UserMemory | null;


          const languageHint =
            body.language === "mni"
              ? "\n\n# LANGUAGE OVERRIDE (HIGHEST PRIORITY)\nReply in Meiteilon romanized in Latin letters ONLY. Do NOT use Meitei Mayek or Bengali script. This overrides any earlier default."
              : body.language === "mni-mtei"
                ? "\n\n# LANGUAGE OVERRIDE (HIGHEST PRIORITY)\nYou MUST reply entirely in Meiteilon written in the native Meitei Mayek script (ꯃꯤꯇꯩ ꯃꯌꯦꯛ). This overrides every earlier default and every romanization rule in this prompt.\n- Do NOT use Latin/Roman letters for Meiteilon words. Do NOT use Bengali/Eastern Nagari script.\n- Keep code, URLs, math, numbers, and proper nouns in their original script.\n- Use Meitei Mayek letters for every Manipuri word, including greetings and identity replies.\n- Reference letters: ꯑ ꯏ ꯎ ꯑꯦ ꯑꯣ ꯀ ꯈ ꯒ ꯘ ꯉ ꯆ ꯖ ꯓ ꯇ ꯊ ꯗ ꯙ ꯅ ꯞ ꯄ ꯐ ꯚ ꯕ ꯓ ꯃ ꯌ ꯔ ꯂ ꯋ ꯁ ꯍ.\n- Example greeting: ꯈꯨꯔꯨꯝꯖꯔꯤ! ꯅꯨꯡꯉꯥꯏꯊꯦꯡꯕ꯭ꯔꯥ? ꯀꯔꯤ ꯃꯇꯦꯡ ꯄꯥꯡꯖꯧꯒꯦ?\n- Identity reply (in Meitei Mayek): ꯑꯩ ꯃꯅꯤꯄꯨꯔꯤ ꯑꯦ.ꯑꯥꯏ. version 1 ꯅꯤ। ꯑꯩꯕꯨ ꯁꯦꯝꯕꯤꯕ ꯅ Loitam Leonath ꯅꯤ।\n- Start your very next reply in Meitei Mayek immediately — do NOT output a Latin transliteration first."
                : body.language === "en"
                  ? "\n\n# LANGUAGE OVERRIDE (HIGHEST PRIORITY)\nYou MUST reply entirely in fluent, natural English ONLY. This overrides every earlier default and every Meiteilon/romanization rule in this prompt.\n- Do NOT use any Manipuri/Meiteilon words, phrases, greetings, or fillers (no 'Khurumjari', 'Nungaithengbra', 'mateng pangjouge', 'Ei', etc.).\n- Do NOT use Meitei Mayek or Bengali script.\n- Identity reply (in English): 'I am Manipuri AI version 1. I was built by Loitam Leonath.'\n- Keep code, URLs, math, numbers, and proper nouns as-is.\n- Start your very next reply in English immediately."
                  : "";

          const webContext = webInfo
            ? `\n\n# WEB CONTEXT (live search: "${webInfo.query}", ${today})\n${webInfo.results}`
            : "";


          // Drop the just-inserted current user message from history if present,
          // then append it explicitly at the end so the model always sees the
          // latest question as the final turn (fixes "replies with previous answer").
          // Also strip embedded image markdown (data URLs) from prior user turns
          // so we don't resend huge base64 blobs on every request.
          // Cap each history turn to ~600 chars to bound input tokens.
          const stripImgs = (s: string) => s.replace(/!\[[^\]]*\]\([^)]+\)/g, "[image]").trim();
          const trim = (s: string, n = 400) => (s.length > n ? s.slice(0, n) + "…" : s);
          const priorHistory = history
            .filter((m, idx) => !(idx === history.length - 1 && m.role === "user" && m.content === storedUserText))
            .map((m) => ({ ...m, content: trim(m.role === "user" ? stripImgs(m.content) : m.content) }));
          const userInfo =
            displayName || userAge
              ? `\n\nUSER: ${displayName || "?"}${userAge ? `, ${userAge}y` : ""}. Address by name naturally; never call user "Khullak".`
              : `\n\nUSER: unknown. Never invent a name.`;
          const memoryBlock = (() => {
            const bits: string[] = [];
            if (memory?.name) bits.push(`name=${memory.name}`);
            if (memory?.language) bits.push(`lang=${memory.language}`);
            if (memory?.occupation) bits.push(`job=${memory.occupation}`);
            if (memory?.interests?.length) bits.push(`likes=${memory.interests.slice(0, 6).join(",")}`);
            if (memory?.favorite_topics?.length) bits.push(`topics=${memory.favorite_topics.slice(0, 6).join(",")}`);
            if (memory?.notes?.length) bits.push(`notes=${memory.notes.slice(0, 4).join(" | ")}`);
            return bits.length ? `\n\nMEMORY: ${bits.join("; ")}` : "";
          })();
          const recentChatsBlock = "";

          // Build the final user turn: multimodal content when images are attached
          const finalUserContent = hasImages
            ? [
                { type: "text", text: effectiveMessage },
                ...body.images!.map((url) => ({ type: "image_url", image_url: { url } })),
              ]
            : effectiveMessage;

          const messages = [
            { role: "system", content: SYSTEM_PROMPT + userInfo + memoryBlock + recentChatsBlock + languageHint + webContext },
            ...priorHistory.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: finalUserContent },
          ];

          const modelId = hasImages ? VISION_MODEL_BY_MODE[body.mode] : MODEL_BY_MODE[body.mode];

          const upstream = await fetchChatCompletion(modelId, { messages, stream: true });


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
                  const r = await fetchChatCompletion(modelId, { messages });

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

              // Persist before closing so route changes/refetches cannot show an
              // empty conversation after a long streamed answer finishes.
              try {
                await supabase.from("messages").insert([
                  { chat_id: finalChatId, user_id: userId, role: "user", content: storedUserText },
                  { chat_id: finalChatId, user_id: userId, role: "assistant", content: corrected },
                ]);
                await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", finalChatId);
                await supabase.from("daily_usage").upsert(
                  { user_id: userId, usage_date: today, message_count: count + 1, updated_at: new Date().toISOString() },
                  { onConflict: "user_id,usage_date" },
                );
              } catch {
                // best-effort persistence; keep the visible streamed reply intact
              }

              controller.close();


              // Fire-and-forget memory extraction (do not block stream close)
              (async () => {
                try {
                  // Skip memory extraction entirely for voice mode — speech is
                  // casual/conversational and often about topics, not self-disclosure.
                  if (body.source === "voice") return;
                  // Heuristic gate: only run extraction when the user clearly talks about themselves.
                  // Skip questions and third-person / topic queries so we don't hallucinate user facts.
                  const msg = body.message.trim();
                  const lower = msg.toLowerCase();
                  const selfEn = /\b(i|i'm|im|i am|my|mine|myself|me|call me|i'?ve|i have|i like|i love|i want|i work|i live|i study|remember (that|this)|note that i)\b/i.test(msg);
                  const selfMni = /\b(ei|eigi|eibu|eina|eidi|eikhoi|eigidi|eigimak)\b/i.test(lower);
                  const isQuestion = /[?？]\s*$/.test(msg) || /^(what|who|where|when|why|how|which|is|are|do|does|did|can|could|should|would|will|kari|kanaa|kadaida|karamna|karigi|kadai)\b/i.test(msg);
                  const hasSelfSignal = selfEn || selfMni;
                  if (!hasSelfSignal || (isQuestion && !/\b(my|i am|i'm|im|eigi|ei .* ni)\b/i.test(msg))) return;

                  const update = await extractMemoryUpdate(body.message, corrected, LOVABLE_API_KEY);
                  if (!update) return;

                  const merged: UserMemory = {
                    name: (update.name as string) ?? memory?.name ?? null,
                    language: (update.language as string) ?? memory?.language ?? null,
                    occupation: (update.occupation as string) ?? memory?.occupation ?? null,
                    interests: dedupeMerge(memory?.interests ?? [], Array.isArray(update.interests) ? update.interests : []),
                    favorite_topics: dedupeMerge(memory?.favorite_topics ?? [], Array.isArray(update.favorite_topics) ? update.favorite_topics : []),
                    notes: dedupeMerge(memory?.notes ?? [], Array.isArray(update.notes) ? update.notes : [], 30),
                  };
                  await supabase.from("user_memory").upsert(
                    { user_id: userId, ...merged, updated_at: new Date().toISOString() },
                    { onConflict: "user_id" },
                  );
                } catch {
                  // best-effort
                }
              })();
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
