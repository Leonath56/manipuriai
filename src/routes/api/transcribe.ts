import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/transcribe")({
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
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: userData } = await supabase.auth.getUser(token);
          if (!userData.user?.id) return new Response("Unauthorized", { status: 401 });

          const form = await request.formData();
          const file = form.get("file");
          const language = (form.get("language") as string | null) ?? "auto";
          if (!(file instanceof File) || file.size < 512) {
            return new Response(JSON.stringify({ error: "Empty or missing audio" }), {
              status: 400, headers: { "Content-Type": "application/json" },
            });
          }

          const mime = (file.type || "").split(";")[0] || "audio/webm";
          const ext = mime === "audio/mp4" ? "mp4"
            : mime === "audio/mpeg" ? "mp3"
            : mime === "audio/wav" || mime === "audio/wave" ? "wav"
            : mime === "audio/ogg" ? "ogg"
            : "webm";

          // Whisper-family models perform poorly on Meiteilon. Route Manipuri
          // AND auto-detect through Gemini chat completions with audio input —
          // it handles Meiteilon much better and can output romanized Latin or
          // Meitei Mayek, and also transcribes English cleanly.
          const useGemini = language === "mni" || language === "mni-mtei" || language === "auto";
          if (useGemini) {
            const buf = new Uint8Array(await file.arrayBuffer());
            let bin = "";
            for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            const b64 = btoa(bin);
            const audioFmt = ext === "mp3" ? "mp3"
              : ext === "wav" ? "wav"
              : ext === "mp4" ? "m4a"
              : ext === "ogg" ? "ogg"
              : "webm";

            let sysPrompt: string;
            let userText: string;
            if (language === "mni-mtei") {
              sysPrompt = "You are a precise transcriber for Meiteilon (Manipuri). Transcribe the audio EXACTLY as spoken in Manipuri using Meitei Mayek script (ꯃꯤꯇꯩ ꯃꯌꯦꯛ). Do NOT translate. Do NOT add commentary, quotes, or explanations. Output ONLY the transcript. If audio is silent or unintelligible, output an empty string.";
              userText = "Transcribe this Manipuri audio in Meitei Mayek script. Output only the transcript.";
            } else if (language === "mni") {
              sysPrompt = "You are a precise transcriber for Meiteilon (Manipuri). Transcribe the audio EXACTLY as spoken in Manipuri using romanized Latin letters (e.g. 'Nungaithengbra'). Do NOT translate. Do NOT add commentary, quotes, or explanations. Output ONLY the transcript. If audio is silent or unintelligible, output an empty string.";
              userText = "Transcribe this Manipuri audio in romanized Latin letters. Output only the transcript.";
            } else {
              // auto: detect Manipuri vs English and transcribe in the spoken language
              sysPrompt = "You are a precise transcriber that supports Meiteilon (Manipuri) and English. Detect the spoken language and transcribe the audio EXACTLY as spoken. For Manipuri, use romanized Latin letters (e.g. 'Nungaithengbra'). For English, use standard English. Do NOT translate between languages. Do NOT add commentary, quotes, or explanations. Output ONLY the transcript text. If audio is silent or unintelligible, output an empty string.";
              userText = "Transcribe this audio in the spoken language (Manipuri in romanized Latin, or English). Output only the transcript.";
            }

            const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-pro",
                messages: [
                  { role: "system", content: sysPrompt },
                  {
                    role: "user",
                    content: [
                      { type: "text", text: userText },
                      { type: "input_audio", input_audio: { data: b64, format: audioFmt } },
                    ],
                  },
                ],
              }),
            });
            if (!res.ok) {
              const err = await res.text().catch(() => "");
              return new Response(JSON.stringify({ error: err || `Transcription failed (${res.status})` }), {
                status: res.status, headers: { "Content-Type": "application/json" },
              });
            }
            const json = await res.json();
            const text: string = (json?.choices?.[0]?.message?.content ?? "").toString().trim().replace(/^["']|["']$/g, "");
            return new Response(JSON.stringify({ text }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          // English / auto → higher-accuracy OpenAI transcribe.
          const upstream = new FormData();
          upstream.append("model", "openai/gpt-4o-transcribe");
          upstream.append("file", file, `recording.${ext}`);
          if (language === "en") upstream.append("language", "en");

          const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` },
            body: upstream,
          });
          if (!res.ok) {
            const err = await res.text().catch(() => "");
            return new Response(JSON.stringify({ error: err || `Transcription failed (${res.status})` }), {
              status: res.status, headers: { "Content-Type": "application/json" },
            });
          }
          const json = await res.json();
          const text: string = (json?.text ?? "").toString().trim();
          return new Response(JSON.stringify({ text }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Server error";
          return new Response(JSON.stringify({ error: msg }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
