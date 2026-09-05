import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PLAN_LIMITS, type Plan } from "@/lib/plans";
import { parseImageRequest } from "@/lib/image-intent";
import { validateImageInputs } from "@/lib/image-input";
import { fetchChatCompletion, lovableOnlyEndpoint } from "@/lib/ai-provider.server";
import { getActiveMcpServers, listMcpTools, callMcpTool } from "@/lib/mcp-client.server";

const BodySchema = z.object({
  chatId: z.string().uuid().nullable(),
  message: z.string().trim().max(8000),
  language: z.enum(["auto", "mni", "mni-mtei", "en"]).default("auto"),
  mode: z.enum(["instant", "think"]).default("instant"),
  images: z.array(z.string()).max(4).optional().default([]),
  source: z.enum(["chat", "voice"]).optional().default("chat"),
  // Ids of messages the client is replacing (regenerate / edit-and-resend).
  // They stay in the database until this turn succeeds, but must be hidden
  // from the model's history so it doesn't see the old turn twice.
  omitMessageIds: z.array(z.string().uuid()).max(200).optional().default([]),
}).refine((v) => v.message.length > 0 || (v.images && v.images.length > 0), {
  message: "Message or image is required",
});

// How much conversation the model actually receives. The previous values
// (4 messages / 400 chars) made the assistant forget the last question.
const HISTORY_MESSAGE_LIMIT = 12;
const HISTORY_CHAR_LIMIT = 1400;

// Agent tools are powerful but discovering and serializing them on every ordinary
// chat turn delays time-to-first-token. Only attach them when the user is
// explicitly asking the assistant to perform an action that may need a tool.
const MCP_INTENT_REGEX = /\b(mcp|agent tool|use (?:an? )?tool|use my (?:connected )?(?:app|integration)|connected (?:app|integration)|manage my chats?|rename my chats?|delete my chats?|list my chats?|search my chats?|open my chats?)\b/i;

function mayNeedMcpTools(message: string): boolean {
  return MCP_INTENT_REGEX.test(message);
}

const ROMANIZED_MEITEILON_REGEX = /\b(khurumjari|khurumjari|nungairibra|nungai|kadaino|kari|karino|karigi|karamba|eigi|eina|eidi|nang|nangbu|nahak|adom|yamna|phajana|thagatchari|mateng|touba|touri|touge|leiri|leibra|leitre|chatpa|chatli|lakpa|laakpa|khangba|khangde|haibiyu|haige|pambadi|oiribra|oire|natte|hoi|yare|yaroi|ngasi|hayeng|matam|thabak|yumda|imphal)\b/i;
const MEITEI_MAYEK_REGEX = /[ꯀ-꯿]/;

function resolveReplyLanguage(language: z.infer<typeof BodySchema>["language"], message: string) {
  if (language !== "auto") return language;
  if (MEITEI_MAYEK_REGEX.test(message)) return "mni-mtei" as const;
  if (ROMANIZED_MEITEILON_REGEX.test(message)) return "mni" as const;
  return "en" as const;
}

const MODEL_BY_MODE = {
  instant: "google/gemini-3.7-flash",
  think: "google/gemini-3.1-pro-preview",
} as const;

// Vision-capable models used when images are attached
const VISION_MODEL_BY_MODE = {
  instant: "google/gemini-3.7-flash",
  think: "google/gemini-3.1-pro-preview",
} as const;

function imageSizeFor(aspect: "1:1" | "16:9" | "9:16") {
  if (aspect === "16:9") return "1536x1024";
  if (aspect === "9:16") return "1024x1536";
  return "1024x1024";
}

const SYSTEM_PROMPT = `You are Manipuri AI version 1.2, a highly capable general assistant with native-level Meiteilon ability. Answer the current request directly and accurately. You can handle coding, mathematics, science, writing, analysis, and everyday questions.

IDENTITY
Only when asked who you are or who made you, say: "Ei Manipuri AI version 1.2 ni. Eibu sembiba na Loitam Leonath ni." Do not mention the underlying model or provider.

CONVERSATION
- Prioritize the user's current message. Use earlier turns only when they are genuinely relevant or the user refers back to them.
- Never introduce unrelated topics from chat history or saved memory.
- Saved memory is private background context. Do not list or volunteer it.
- For an ambiguous one-word follow-up, ask one short clarifying question instead of guessing a topic.
- For a greeting-only message, reply with one brief, natural greeting. Vary repeated greetings without adding unrelated suggestions.
- Keep simple answers concise. Use Markdown only when structure helps; do not force headings, bullets, or bold text into short conversational replies.
- If uncertain about a fact or a Meiteilon word, say so briefly. Never invent vocabulary.

LANGUAGE
Follow the final LANGUAGE CONTRACT exactly. Mirror natural mixed Manipuri-English messages rather than forcing artificial purity. Keep common modern terms such as phone, internet, AI, app, video, school, college, doctor, bank, train, ticket, code, file, upload, and download in English when that is how native speakers normally say them.

MEITEILON QUALITY
- Write natural contemporary Meiteilon as spoken by native speakers in Manipur, not a word-for-word English translation.
- Meiteilon is generally subject-object-verb. Preserve natural SOV order, but do not mechanically distort fragments, headings, quotations, code, or established expressions.
- Attach productive markers naturally: -na, -bu/-pu, -da/-ta, -dagi, -ga, -gi, and -di. Do not separate a suffix from its word.
- Choose tense and mood from meaning: -ri/-li for ongoing action, -khi for past, -khre/-re for completed action, -gani for expected future, -ge/-jouge/-louge for intention, and -de/-te for negation.
- Keep sentences short and idiomatic. Use one consistent spelling and one politeness level within a reply.
- Avoid Bengali/Hindi substitutions such as ami, tumi, ache, dhanyabad, kemon, kothay, keno, sahayak, kaj, somoy, khub, bhalo, ekta, and kintu.
- Prefer native everyday forms where confident: ei/eigi, nang/nanggi, adom/adomgi, eikhoi, mahak, makhoi, kari, karigi, kadaida, mateng, thabak, matam, yamna, phaba, ama, adubu, lei/leiri, khangba, touba, piba, phangba, yengba, haiba, chatpa, laakpa, thagatchari, khurumjari, and nungairibra.
- Never coin a supposedly native technical word. A familiar English term is better than an invented Meiteilon term.
- Do not claim that every sentence must end in a verb; apply grammar naturally according to the sentence type.

SAFETY AND ACCURACY
Be neutral and respectful when discussing Meitei, Naga, Kuki, Pangal, ethnic, religious, or political topics. When live web context is supplied, use it carefully and distinguish confirmed facts from uncertainty.`


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
              : "Decide if answering the user needs fresh/current web info (news, sports scores, live events, recent releases, prices, weather, people's current roles, anything after early 2026). If YES, output ONLY an English web search query (max 12 words). If NO, output exactly: NO.",
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

type McpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  serverUrl: string;
  apiKey: string | null;
};

// MCP tool discovery used to run on every single chat request: one query for
// the server list plus a live `tools/list` round-trip per server, all before
// the model call could start. Cache it — tool definitions change rarely, and
// this was pure time-to-first-token.
const MCP_TOOLS_TTL_MS = 60_000;
let mcpToolsCache: { at: number; tools: McpToolDescriptor[] } | null = null;
let mcpToolsInflight: Promise<McpToolDescriptor[]> | null = null;

async function loadMcpTools(): Promise<McpToolDescriptor[]> {
  const now = Date.now();
  if (mcpToolsCache && now - mcpToolsCache.at < MCP_TOOLS_TTL_MS) return mcpToolsCache.tools;
  if (mcpToolsInflight) return mcpToolsInflight;

  mcpToolsInflight = (async () => {
    try {
      const servers = await getActiveMcpServers();
      if (!servers.length) return [];
      const perServer = await Promise.all(
        servers.map(async (server) => {
          try {
            const tools = await listMcpTools(server.url, server.api_key || undefined);
            return tools.map((t) => ({ ...t, serverUrl: server.url, apiKey: server.api_key }));
          } catch {
            // One unreachable MCP server must not break chat.
            return [];
          }
        }),
      );
      return perServer.flat() as McpToolDescriptor[];
    } catch {
      return [];
    }
  })();

  try {
    const tools = await mcpToolsInflight;
    mcpToolsCache = { at: Date.now(), tools };
    return tools;
  } finally {
    mcpToolsInflight = null;
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        /*
         * Held outside the try so the outer catch can hand the quota back. The
         * daily count is incremented atomically before the model runs, and every
         * *known* failure path already refunds it — but an unexpected throw
         * between the increment and the response left the message charged with
         * nothing to show for it.
         */
        let refundOnUnhandledFailure: (() => Promise<void>) | null = null;
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

          // Zod caps the image *count*; this caps the part that actually costs
          // something — decoded bytes — and rejects anything that isn't a
          // data-URL image. Runs before the quota increment so a rejected
          // payload doesn't spend a message.
          const imageCheck = validateImageInputs(body.images, { maxCount: 4 });
          if (!imageCheck.ok) {
            return new Response(JSON.stringify({ error: imageCheck.reason }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          // plan + atomic usage increment in parallel (RPC via service role — restricted from client roles)
          const today = new Date().toISOString().slice(0, 10);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const [profileRes, incRes] = await Promise.all([
            supabase.from("profiles").select("plan, full_name, username, age").eq("id", userId).maybeSingle(),
            supabaseAdmin.rpc("increment_daily_usage", { _user_id: userId, _usage_date: today }),
          ]);
          const plan: Plan = (profileRes.data?.plan as Plan) ?? "free";
          const displayName =
            (profileRes.data?.full_name as string | null)?.split(" ")[0] ||
            (profileRes.data?.username as string | null) ||
            "";
          const userAge = profileRes.data?.age as number | null | undefined;
          const limit = PLAN_LIMITS[plan];
          const newCount = (incRes.data as number | null) ?? 0;

          // The quota was consumed up-front (it has to be atomic), so give it
          // back whenever this request does not actually produce a reply.
          // Without this, a stopped or failed generation still burns a message.
          let quotaCharged = incRes.error == null;
          const refundQuota = async () => {
            if (!quotaCharged) return;
            quotaCharged = false;
            try {
              await supabaseAdmin.rpc("refund_daily_usage", { _user_id: userId, _usage_date: today });
            } catch {
              // best-effort — never fail a request because a refund failed
            }
          };
          refundOnUnhandledFailure = refundQuota;

          if (newCount > limit.dailyMessages) {
            // Over the limit: this attempt must not count against tomorrow's
            // rollover either, so hand the increment straight back.
            await refundQuota();
            return new Response(
              JSON.stringify({ error: `Daily limit reached (${limit.dailyMessages} on ${limit.label}). Upgrade at /plans.` }),
              { status: 429, headers: { "Content-Type": "application/json" } },
            );
          }

          const hasImages = (body.images?.length ?? 0) > 0;
          let chatId = body.chatId;

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
          if (!chatId) {
            const title = (body.message || "Image chat").slice(0, 60);
            const { data: newChat, error } = await supabase
              .from("chats")
              .insert({ user_id: userId, title })
              .select("id")
              .single();
            if (error) {
              console.error("[chat] create chat failed", error.message);
              return new Response("Couldn't start a new chat. Please try again.", { status: 400 });
            }
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
              const detail = await imageRes.text().catch(() => "");
              const status = imageRes.status === 429 ? 429 : imageRes.status === 402 ? 402 : 500;
              // Logged rather than forwarded — the provider's body carries
              // request ids and quota internals.
              console.error("[chat] image generation failed", imageRes.status, detail.slice(0, 300));
              const message =
                status === 429
                  ? "Image generation is busy right now. Please try again in a moment."
                  : status === 402
                    ? "Image generation is unavailable on this plan."
                    : "Couldn't generate that image. Please try again.";
              return new Response(JSON.stringify({ error: message }), {
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

            const encoder = new TextEncoder();
            const finalChatId = chatId;
            const imageStream = new ReadableStream({
              start(controller) {
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

                try {
                  safeEnqueue(encoder.encode(`__META__${JSON.stringify({ chatId: finalChatId })}\n`));
                  safeEnqueue(encoder.encode(assistantContent));
                  safeClose();
                } catch {
                  // client disconnected before the image reply was flushed
                }


                void (async () => {
                  try {
                    // Explicit timestamps 1ms apart — a single multi-row insert
                    // gives both rows the same transaction time, which made the
                    // question/answer order non-deterministic on reload.
                    const userAt = new Date();
                    const assistantAt = new Date(userAt.getTime() + 1);
                    await supabase.from("messages").insert([
                      { chat_id: finalChatId, user_id: userId, role: "user", content: storedUserText, created_at: userAt.toISOString() },
                      { chat_id: finalChatId, user_id: userId, role: "assistant", content: assistantContent, created_at: assistantAt.toISOString() },
                    ]);
                    await supabase.from("chats").update({ updated_at: assistantAt.toISOString(), kind: "image" }).eq("id", finalChatId);
                    // daily_usage already incremented atomically at request start

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
                const keywordHit = mayNeedWebSearch(body.message);
                // Instant mode: only search when the keyword regex fires, and
                // skip the extra LLM "decide + rewrite query" call — use the
                // user's raw message as the query. Saves ~500–1500ms.
                if (body.mode === "instant") {
                  if (!keywordHit) return null;
                  const q = body.message.slice(0, 160);
                  const results = await firecrawlSearch(q, 5, 2200);
                  return results ? { query: q, results } : null;
                }
                // Think mode: keep the smart query rewrite for better recall.
                const q = await decideWebSearch(body.message, LOVABLE_API_KEY, true);
                if (!q) return null;
                const results = await firecrawlSearch(q, 8, 3500);
                return results ? { query: q, results } : null;
              })();


          const shouldLoadMcpTools = mayNeedMcpTools(body.message);
          const [historyRes, webInfo, memoryRes, mcpTools] = await Promise.all([
            supabase
              .from("messages")
              .select("id, role, content")
              .eq("chat_id", chatId)
              .order("created_at", { ascending: false })
              .limit(HISTORY_MESSAGE_LIMIT + body.omitMessageIds.length),
            webPromise,
            supabase
              .from("user_memory")
              .select("name, language, occupation, interests, favorite_topics, notes")
              .eq("user_id", userId)
              .maybeSingle(),
            // Tool discovery is cached (see mcp-client.server) so this no longer
            // costs a live round-trip to every MCP server on every message.
            shouldLoadMcpTools ? loadMcpTools() : Promise.resolve([]),
          ]);
          const omitIds = new Set(body.omitMessageIds);
          const history = (historyRes.data ?? [])
            .filter((m) => !omitIds.has(m.id))
            .slice(0, HISTORY_MESSAGE_LIMIT)
            .reverse();
          const memory = (memoryRes.data ?? null) as UserMemory | null;

          // Convert MCP tools to model-friendly format
          const tools = mcpTools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            },
          }));


          const replyLanguage = resolveReplyLanguage(body.language, body.message);
          const languageHint =
            replyLanguage === "mni"
              ? `

# LANGUAGE CONTRACT — ROMANIZED MEITEILON
Reply in natural Romanized Meiteilon using Latin letters. Match the user's casual spelling and level of formality. Use natural SOV grammar and attached suffixes, but do not force rigid textbook patterns. Mix in familiar English terms only where native speakers normally would. Before sending, silently remove invented words, Bengali/Hindi substitutions, and translation-like phrasing.`
              : replyLanguage === "mni-mtei"
                ? `

# LANGUAGE CONTRACT — MEITEI MAYEK
Reply in natural Meiteilon written in Meitei Mayek. Do not output a Latin transliteration first. Keep code, URLs, numbers, and proper nouns in their original form. Prefer short, idiomatic sentences and never invent spellings or vocabulary.`
                : `

# LANGUAGE CONTRACT — ENGLISH
Reply in fluent natural English. Do not add Manipuri greetings or fillers unless the user asks for them.`;

          const webContext = webInfo
            ? `\n\n# WEB CONTEXT (live search: "${webInfo.query}", ${today})\n${webInfo.results}`
            : "";


          // Drop the just-inserted current user message from history if present,
          // then append it explicitly at the end so the model always sees the
          // latest question as the final turn (fixes "replies with previous answer").
          // Also strip embedded image markdown (data URLs) from prior user turns
          // except for the very last user message if it's the current one (handled below).
          // We intentionally DO NOT strip the [image] placeholder to maintain context.

          // Cap each history turn to HISTORY_CHAR_LIMIT chars to bound input tokens.
          // Keep a text indicator of images in history without sending the large data URLs
          const stripImgs = (s: string) => s.replace(/!\[[^\]]*\]\([^)]+\)/g, "[attached image]").trim();
          const trim = (s: string, n = HISTORY_CHAR_LIMIT) => (s.length > n ? s.slice(0, n) + "…" : s);
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
            return bits.length
              ? `\n\nMEMORY (private background only; never mention or list these facts unless directly relevant to the current request): ${bits.join("; ")}`
              : "";
          })();
          const recentChatsBlock = "";

          // Build the final user turn: multimodal content when images are attached
          const finalUserContent = hasImages
            ? [
                { type: "text", text: effectiveMessage },
                ...body.images!.map((url) => ({ type: "image_url", image_url: { url } })),
              ]
            : effectiveMessage;

          const mcpContext = mcpTools.length > 0
            ? `\n\n# AVAILABLE AGENT TOOLS (MCP)\nYou have access to the following specialized tools via MCP:\n${mcpTools.map(t => `- ${t.name}: ${t.description}`).join("\n")}\nUse these tools when needed to provide accurate and up-to-date information.`
            : "";

          const meiteilonGuard = replyLanguage === "en"
            ? ""
            : "\n\nFinal language check: prefer a short native expression over a literal translation; keep spelling consistent; do not invent words; answer only the current request.";

          const messages = [
            { role: "system", content: SYSTEM_PROMPT + userInfo + memoryBlock + recentChatsBlock + languageHint + webContext + mcpContext + "\n\nCRITICAL: Always look at the full conversation history. If the user refers to something previously discussed or an image uploaded earlier, use that context. Do not ignore previous turns." + meiteilonGuard },
            ...priorHistory.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: finalUserContent },
          ];

          const modelId = hasImages ? VISION_MODEL_BY_MODE[body.mode] : MODEL_BY_MODE[body.mode];

          const finalChatId = chatId;
          const encoder = new TextEncoder();
          const decoder = new TextDecoder();

          const stream = new ReadableStream({
            async start(controller) {
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
                try {
                  controller.close();
                } catch {
                  // already closed by client disconnect
                }
              };

              // Persisting the turn used to happen only after a fully
              // successful stream, so pressing "Stop" — or simply losing the
              // connection — threw away the user's question *and* whatever the
              // model had already written. persistTurn() is now called on every
              // exit path, including abort, and is idempotent. It returns the
              // (vocabulary-corrected) text it actually inserted, or "" when
              // there was nothing to save.
              //
              // `isPlaceholder` marks a failure notice rather than a real reply.
              // A regenerate/edit only deletes the rows it replaces once a
              // replacement was saved, so saving a placeholder for those would
              // trade a good answer for an error message. In that case the
              // client still has the original — save nothing.
              const isReplacingExistingTurn = body.omitMessageIds.length > 0;
              let persisted = false;
              const persistTurn = async (assistantText: string, isPlaceholder = false): Promise<string> => {
                if (persisted) return "";
                if (isPlaceholder && isReplacingExistingTurn) return "";
                persisted = true;
                const text = assistantText.trim();
                if (!text) return "";
                // Vocabulary correction.
                const corrected = text
                  .replace(/pangbageda/gi, "mateng pangjouge")
                  .replace(/amendaba/gi, "pendaba");
                try {
                  // Stamp the assistant row 1ms after the user row. A single
                  // multi-row insert gives both rows the same transaction
                  // timestamp, which left the UI sorting them non-deterministically.
                  const userAt = new Date();
                  const assistantAt = new Date(userAt.getTime() + 1);
                  await supabase.from("messages").insert([
                    { chat_id: finalChatId, user_id: userId, role: "user", content: storedUserText, created_at: userAt.toISOString() },
                    { chat_id: finalChatId, user_id: userId, role: "assistant", content: corrected, created_at: assistantAt.toISOString() },
                  ]);
                  await supabase.from("chats").update({ updated_at: assistantAt.toISOString() }).eq("id", finalChatId);
                  return corrected;
                } catch {
                  // best-effort persistence; keep the visible streamed reply intact
                  return corrected;
                }
              };

              // Flush chatId frame IMMEDIATELY so the UI can show the typing
              // indicator and mount the streaming bubble while we're still
              // opening the upstream AI connection (saves the full request RTT
              // off perceived time-to-first-token).
              safeEnqueue(encoder.encode(`__META__${JSON.stringify({ chatId: finalChatId })}\n`));

              let firstChunkSeen = false;
              const heartbeat = setInterval(() => {
                if (!firstChunkSeen) {
                  if (!safeEnqueue(encoder.encode("\u200B"))) clearInterval(heartbeat);
                }
              }, 3000);

              // Open the upstream AI connection AFTER response headers are
              // already on the wire.
              let upstream: Response;
              try {
                // If there are tools, we use them. Gemini 2.5 Pro supports tool calling.
                const aiPayload: any = { messages, stream: true };
                if (tools.length > 0) {
                  aiPayload.tools = tools;
                  aiPayload.tool_choice = "auto";
                }
                upstream = await fetchChatCompletion(modelId, aiPayload, { signal: request.signal });
              } catch {
                clearInterval(heartbeat);
                await refundQuota();
                const msg = "AI request failed. Please retry.";
                safeEnqueue(encoder.encode(msg));
                // Save the turn anyway: an unanswered question that vanishes on
                // the next refetch reads as data loss, and keeping it lets the
                // user hit Regenerate instead of retyping.
                await persistTurn(msg, true);
                safeClose();
                return;
              }
              if (!upstream.ok || !upstream.body) {
                clearInterval(heartbeat);
                await refundQuota();
                const t = await upstream.text().catch(() => "");
                const msg = t.slice(0, 300) || "AI request failed";
                safeEnqueue(encoder.encode(msg));
                await persistTurn(msg, true);
                safeClose();
                return;
              }

              let buffer = "";
              let full = "";
              // Keyed by the provider's `index` — the deltas can arrive
              // out of order and with gaps, so a plain array left holes that
              // crashed the executor loop below with "cannot read 'name' of
              // undefined" and killed the whole stream.
              const toolCallsByIndex = new Map<number, { id?: string; type?: string; function: { name: string; arguments: string } }>();
              const reader = upstream.body.getReader();
              const onAbort = () => { void reader.cancel().catch(() => {}); };
              request.signal.addEventListener("abort", onAbort);
              let clientGone = false;
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

                      // Handle tool calls in streaming
                      if (choice?.delta?.tool_calls) {
                        for (const tc of choice.delta.tool_calls) {
                          const idx = typeof tc.index === "number" ? tc.index : 0;
                          const existing = toolCallsByIndex.get(idx);
                          if (!existing) {
                            // Copy — never mutate the parsed delta in place.
                            toolCallsByIndex.set(idx, {
                              id: tc.id,
                              type: tc.type ?? "function",
                              function: {
                                name: tc.function?.name ?? "",
                                arguments: tc.function?.arguments ?? "",
                              },
                            });
                          } else {
                            if (tc.id) existing.id = tc.id;
                            if (tc.function?.name) existing.function.name = tc.function.name;
                            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                          }
                        }
                      }

                      const delta: string | undefined =
                        choice?.delta?.content ?? choice?.message?.content;
                      if (delta) {
                        firstChunkSeen = true;
                        full += delta;
                        if (!safeEnqueue(encoder.encode(delta))) {
                          // Client went away. Stop reading upstream, but keep
                          // what we have so the turn is still saved below.
                          clientGone = true;
                          await reader.cancel().catch(() => {});
                          break;
                        }
                      }
                    } catch {
                      // ignore
                    }
                  }
                  if (clientGone) break;
                }

                if (clientGone) {
                  clearInterval(heartbeat);
                  await persistTurn(full);
                  safeClose();
                  return;
                }

                const toolCalls = [...toolCallsByIndex.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([, v]) => v)
                  .filter((tc) => tc.function.name);

                // Execute tool calls if any
                if (toolCalls.length > 0) {
                  const toolResults = [];
                  for (const tc of toolCalls) {
                    const name = tc.function.name;
                    // A truncated stream can leave arguments as invalid JSON.
                    // That must not take the whole reply down.
                    let args: Record<string, any> = {};
                    try {
                      const parsed = JSON.parse(tc.function.arguments || "{}");
                      if (parsed && typeof parsed === "object") args = parsed;
                    } catch {
                      args = {};
                    }
                    const mcpTool = mcpTools.find(t => t.name === name);

                    if (mcpTool) {
                      try {
                        // Indicate tool usage to the user
                        safeEnqueue(encoder.encode(`\n\n> [Tool: ${name}]\n\n`));
                        const result = await callMcpTool(mcpTool.serverUrl, name, args, mcpTool.apiKey || undefined);
                        toolResults.push({
                          role: "tool",
                          tool_call_id: tc.id,
                          name,
                          content: JSON.stringify(result)
                        });
                      } catch (err) {
                        toolResults.push({
                          role: "tool",
                          tool_call_id: tc.id,
                          name,
                          content: `Error: ${err instanceof Error ? err.message : String(err)}`
                        });
                      }
                    }
                  }

                  if (toolResults.length > 0) {
                    // Send tool results back to the model for final response
                    const finalMessages = [
                      ...messages,
                      { role: "assistant", tool_calls: toolCalls },
                      ...toolResults
                    ];
                    
                    const finalUpstream = await fetchChatCompletion(modelId, {
                      messages: finalMessages,
                      stream: true
                    }, { signal: request.signal });

                    if (finalUpstream.ok && finalUpstream.body) {
                      const finalReader = finalUpstream.body.getReader();
                      let finalBuffer = "";
                      while (true) {
                        const { done, value } = await finalReader.read();
                        if (done) break;
                        if (request.signal.aborted || closed) {
                          await finalReader.cancel().catch(() => {});
                          break;
                        }
                        finalBuffer += decoder.decode(value, { stream: true });
                        const finalLines = finalBuffer.split("\n");
                        finalBuffer = finalLines.pop() ?? "";
                        for (const raw of finalLines) {
                          const line = raw.trim();
                          if (!line.startsWith("data:")) continue;
                          const payload = line.slice(5).trim();
                          if (payload === "[DONE]") continue;
                          try {
                            const j = JSON.parse(payload);
                            const delta = j.choices?.[0]?.delta?.content;
                            if (delta) {
                              full += delta;
                              if (!safeEnqueue(encoder.encode(delta))) {
                                await finalReader.cancel().catch(() => {});
                                break;
                              }
                            }
                          } catch {}
                        }
                      }
                    }

                  }
                }
              } catch (err) {
                clearInterval(heartbeat);
                // Client disconnects abort the reader — that is not a server error.
                if (request.signal.aborted || closed || (err as Error)?.name === "AbortError") {
                  // Keep whatever the model already produced. Stopping a reply
                  // must not delete the question that produced it.
                  await persistTurn(full);
                  safeClose();
                  return;
                }
                await refundQuota();
                try {
                  controller.error(err);
                } catch {}
                closed = true;
                return;
              } finally {
                request.signal.removeEventListener("abort", onAbort);
              }
              clearInterval(heartbeat);

              // Fallback: reasoning model emitted only thinking tokens with no
              // visible content. Do a non-streaming call and emit the full text.
              if (!full.trim()) {
                try {
                  const r = await fetchChatCompletion(modelId, { messages }, { signal: request.signal });

                  if (r.ok) {
                    const j = await r.json();
                    const content: string = j.choices?.[0]?.message?.content ?? "";
                    if (content) {
                      full = content;
                      safeEnqueue(encoder.encode(content));
                    }
                  }
                } catch {
                  // ignore, fall through to save-empty guard
                }
              }

              let replyFailed = false;
              if (!full.trim()) {
                // No reply was produced, so the message should not be billed.
                // The turn is still saved (with the failure notice) so the
                // user's question is not silently lost and can be regenerated.
                await refundQuota();
                replyFailed = true;
                full = "Sorry, that didn't return a reply. Please try again, or switch reply mode.";
                safeEnqueue(encoder.encode(full));
              }

              const persistedText = await persistTurn(full, replyFailed);

              safeClose();


              // Fire-and-forget memory extraction (do not block stream close)
              (async () => {
                try {
                  // Nothing worth learning from a failure notice.
                  if (replyFailed || !persistedText) return;
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

                  const update = await extractMemoryUpdate(body.message, persistedText, LOVABLE_API_KEY);
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
          // `err.message` used to be returned verbatim, which handed back Zod
          // field paths and Supabase/provider internals. Detail goes to the log.
          const invalid = err instanceof z.ZodError || err instanceof SyntaxError;
          if (!invalid) console.error("[chat] request failed", err);
          await refundOnUnhandledFailure?.();
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
