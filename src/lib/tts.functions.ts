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
          "Speak the text as Manipuri (Meiteilon) written in Latin/roman letters. Pronounce every syllable phonetically as written, in a natural, warm, moderately-paced voice. Do not translate to English.",
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
