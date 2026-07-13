import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PLAN_LIMITS, type Plan } from "./plans";

const SendMessageInput = z.object({
  chatId: z.string().uuid().nullable(),
  message: z.string().trim().min(1).max(8000),
  language: z.enum(["auto", "mni", "en"]).default("auto"),
});

const SYSTEM_PROMPT = `You are Manipuri AI, a helpful bilingual assistant fluent in Manipuri (Meiteilon) and English.

LANGUAGE RULES:
- Auto-detect the language of the user's message.
- If the user writes in Manipuri (Meiteilon), reply in Manipuri using Meitei Mayek OR the same script the user used (Bengali/Meitei/Latin transliteration — mirror the user).
- If the user writes in English, reply in English.
- If the user mixes both, prefer the dominant language.
- If the user explicitly asks for a language, honour it.

STYLE:
- Be warm, concise, and culturally aware of Manipur.
- Use markdown formatting (headings, lists, code blocks) when it helps.
- For code, use fenced code blocks with a language tag.`;

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
        ? "\n\nUser has forced language: reply in Manipuri (Meiteilon)."
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
      body: JSON.stringify({ model: limit.model, messages }),
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
    const reply = json.choices?.[0]?.message?.content?.trim() ?? "";

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

export const touchLastLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", context.userId);
    return { ok: true };
  });
