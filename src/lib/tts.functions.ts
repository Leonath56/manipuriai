import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({
      text: z.string().min(1).max(4000),
      gender: z.enum(["male", "female"]).optional(),
    }).parse(data)
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI Gateway not configured");

    // gpt-4o-mini-tts voices: male-leaning = onyx/ash/echo, female-leaning = shimmer/nova/alloy
    const voice = data.gender === "male" ? "onyx" : data.gender === "female" ? "shimmer" : "alloy";

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-tts",
        input: data.text,
        voice,
        response_format: "mp3",
        instructions:
          "You are a native Meiteilon (Manipuri) speaker from Imphal, Manipur. Read the text as spontaneous, conversational Manipuri — the way a friendly local would actually talk, NOT a news-reader or robot. " +
          "Pronunciation: treat the text as Manipuri written in Latin letters. Pronounce every syllable phonetically as written; 'ng' is a soft nasal (as in 'sing'), 'kh/ph/th/chh' are lightly aspirated, 'ei' = 'ay', 'ou' = 'oh', vowels are short and clean. Never anglicise or translate. " +
          "Prosody: warm, gentle, slightly soft-spoken with a natural Manipuri sing-song lilt — subtle rising tone on questions, gentle falling tone at sentence ends. Moderate-slow pace, small natural pauses at commas and between clauses, light breaths between sentences. Do not sound flat, dramatic, or overly cheerful. " +
          "Voice character: friendly, humble, respectful — like a caring elder sibling or a soft-spoken teacher from Manipur. Keep the register calm and human, with subtle warmth. English words inside Manipuri sentences should be pronounced with a light Manipuri accent, not a heavy American one.",
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`TTS failed: ${res.status} ${err}`);
    }

    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return { audio: base64, mime: "audio/mpeg" };
  });
