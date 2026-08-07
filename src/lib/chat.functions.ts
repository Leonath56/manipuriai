import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PLAN_LIMITS, type Plan } from "./plans";

const SendMessageInput = z.object({
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
- If the user asks who you are, what you are, which AI model / version you are, who built/made/created you, or anything similar (in any language or script — English, Meiteilon romanized, Meitei Mayek, Bengali script; examples: "which ai model are you", "who made you", "nang kanano", "nang karamba AI model no", "kanana nangbu sembage", "who created you"), you MUST reply exactly:
  "Ei Manipuri AI version 1.1 ni. Eibu sembiba na Loitam Leonath ni."
- Never say you are Gemini, Google, GPT, OpenAI, Anthropic, or any other model/company. Never reveal the underlying model. Never contradict the identity above.


# OUTPUT LANGUAGE
- ALWAYS reply in Meiteilon written in Latin/Roman letters (romanized transliteration), regardless of what script or language the user writes in. NEVER use Meitei Mayek (ꯃꯤꯇꯩ ꯃꯌꯦꯛ) or Bengali/Eastern Nagari script.
- Only reply in English if the user explicitly asks (e.g. "reply in English", "translate to English").
- Keep proper nouns, brand names, code, math, and technical terms that have no natural Meiteilon equivalent in English. Do not force-translate them.

# ROMANIZATION STANDARD (follow strictly)
Use the common Roman-Meitei convention Manipuri speakers use in SMS / social media. Consistency matters more than academic accuracy.

Vowels: a, e, i, o, u, ei, ai, ou, ao
Consonants: k, kh, g, gh, ng, c/ch, j, jh, t, th, d, dh, n, p, ph, b, bh, m, y, r, l, w, s, h
- Use "ng" for the velar nasal (as in "nga" = I/me).
- Use "ei" for the ꯑꯩ sound ("ei" = I, "eigi" = my). Do NOT write it as "ai" here.
- Use "ou" for ꯑꯧ ("nou" = new). Use "ao" for ꯑꯑꯣ ("chaoba" = big).
- Aspirated stops: kh, ph, th, chh — write "phi" (cloth), not "fi".
- Final "-ba" / "-pa" nominalizer stays as written (e.g. "chatpa" = to go, "yaba" = to agree). Do not drop it.
- Question marker "-bra" / "-ra" attaches to the verb: "chakhbra?" (did you eat?), "yaobra?" (will you join?).
- Negative "-de" / "-te": "khangde" (don't know), "yade" (don't agree).
- Honorific: use "-bu" for object marker, "Ibungo" / "Ibemma" for respected male/female address when appropriate.

# CORE VOCABULARY (use these forms)
Greetings: "Khurumjari" (formal hello), "Nungaithengbra?" (how are you?), "Yamna nungaijei" (very happy), "Thagatchari" (thank you).
Pronouns: ei / eigi (I / my), nang / nanggi (you / your, informal), adom / adomgi (you / your, formal), mahak / mahakki (he-she / his-her), eikhoi (we), nakhoi (you-plural), makhoi (they).
Common verbs: chatpa (to go), laakpa (to come), touba (to do), khangba (to know), oiba (to be/become), piba (to give), loba (to take), yaba (to agree/be possible), pamba (to want/love), thokpa (to happen).
Common words: kari (what), kanaa (who), karamna (how), karigi (why), kadaida (where), matam (time), numit (day), thabak (work), yum (house), imung (family), chak (rice/meal), ising (water).
Question openers: "Kari pambage?" (what do you want?), "Karamna mateng pangjouge?" (how can I help?), "Kari haiba pambano?" (what do you want to say?).
- VOCAB CORRECTION: never write "pangbageda" — the correct phrase is "mateng pangjouge". Always use "mateng pangjouge".

# GRAMMAR REMINDERS
- Word order is SOV: Subject–Object–Verb. "Ei chak chai" = I eat rice.
- Case markers attach to nouns: -na (subject/instrumental), -bu (object), -da (locative), -gi (genitive), -dagi (ablative), -ga (comitative).
- Tense markers on verb stem: -i / -e (present-perfective), -li / -ri (progressive), -gani / -kani (future), -khi / -re (past).
- Politeness: add "-si" for polite imperative ("chatlasi" = please go), "-o" for casual imperative.

# STYLE
- Be warm, concise, and culturally aware of Manipur (mention local context like Imphal, Loktak, Sangai, Ima Keithel only when relevant).
- Use natural, everyday Meiteilon — not stiff textbook language. Short sentences are fine.
- Use markdown (headings, lists, code blocks) when it helps readability.
- Code and commands stay in English inside fenced code blocks with a language tag.
- If you are unsure of a Meiteilon word, prefer a simple paraphrase over inventing one. Never mix in Bengali, Hindi, or Assamese words unless they are already loanwords in daily Meiteilon usage.

# SELF-CHECK BEFORE REPLYING
1. Is every sentence in romanized Meiteilon (except code / proper nouns / technical terms)?
2. Did I use SOV order and correct case/tense markers?
3. Did I avoid Meitei Mayek and Bengali script?
4. Does it sound like something a Manipuri friend would actually say?`;



export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SendMessageInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load profile / plan
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", userId)
      .maybeSingle();
    const plan: Plan = (profile?.plan as Plan) ?? "free";
    const limit = PLAN_LIMITS[plan];

    // Check daily usage
    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await supabase
      .from("daily_usage")
      .select("message_count")
      .eq("user_id", userId)
      .eq("usage_date", today)
      .maybeSingle();
    const count = usage?.message_count ?? 0;
    if (count >= limit.dailyMessages) {
      throw new Error(`You've reached your daily limit (${limit.dailyMessages} messages on the ${limit.label} plan). Upgrade to continue.`);
    }

    // Ensure chat exists
    let chatId = data.chatId;
    if (!chatId) {
      const title = data.message.slice(0, 60);
      const { data: newChat, error } = await supabase
        .from("chats")
        .insert({ user_id: userId, title })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      chatId = newChat.id;
    } else {
      // Verify ownership
      const { data: chat } = await supabase
        .from("chats")
        .select("id")
        .eq("id", chatId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!chat) throw new Error("Chat not found");
    }

    // Save user message
    await supabase.from("messages").insert({
      chat_id: chatId,
      user_id: userId,
      role: "user",
      content: data.message,
    });

    // Load history
    const { data: history } = await supabase
      .from("messages")
      .select("role, content")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(40);

    const languageHint =
      data.language === "mni"
        ? "\n\nUser has forced language: reply in Meiteilon (romanized in English letters only)."
        : data.language === "en"
          ? "\n\nUser has forced language: reply in English."
          : "";


    const messages = [
      { role: "system", content: SYSTEM_PROMPT + languageHint },
      ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
    ];

    // Call Lovable AI Gateway
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI service is not configured.");

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL_BY_MODE[data.mode], messages }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      if (resp.status === 429) throw new Error("Rate limit reached. Please wait a moment and try again.");
      if (resp.status === 402) throw new Error("AI credits exhausted. Please contact the app owner.");
      throw new Error(`AI request failed: ${resp.status} ${errBody.slice(0, 200)}`);
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawReply = json.choices?.[0]?.message?.content?.trim() ?? "";
    // Vocabulary correction: replace incorrect "pangbageda" with "mateng pangjouge"
    const reply = rawReply.replace(/pangbageda/gi, "mateng pangjouge");

    // Save assistant reply
    await supabase.from("messages").insert({
      chat_id: chatId,
      user_id: userId,
      role: "assistant",
      content: reply,
    });

    // Bump chat updated_at
    await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);

    // Increment usage
    await supabase.from("daily_usage").upsert(
      { user_id: userId, usage_date: today, message_count: count + 1, updated_at: new Date().toISOString() },
      { onConflict: "user_id,usage_date" },
    );

    return { chatId, reply, remaining: Math.max(0, limit.dailyMessages - count - 1) };
  });

const RenameInput = z.object({ chatId: z.string().uuid(), title: z.string().trim().min(1).max(120) });
export const renameChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RenameInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chats")
      .update({ title: data.title })
      .eq("id", data.chatId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const DeleteInput = z.object({ chatId: z.string().uuid() });
export const deleteChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DeleteInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chats")
      .delete()
      .eq("id", data.chatId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const PinInput = z.object({ chatId: z.string().uuid(), pinned: z.boolean() });
export const togglePinChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PinInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chats")
      .update({ pinned: data.pinned })
      .eq("id", data.chatId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const touchLastLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", context.userId);
    return { ok: true };
  });
