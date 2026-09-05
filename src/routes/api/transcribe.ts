import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { chatCompletionsEndpoint, lovableOnlyEndpoint } from "@/lib/ai-provider.server";

/*
 * Upper bound on an uploaded clip. There was only a *minimum* (512 bytes), so
 * any signed-in account could post an arbitrarily large body — and the Gemini
 * path base64-encodes it with a per-byte string append, which turns a large
 * upload into a memory and CPU spike rather than a slow request. 25 MB is about
 * 20 minutes of the composer's own webm/opus recording.
 */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Formats the recorder can actually produce, plus the ones users hand-upload. */
const ALLOWED_AUDIO_MIME = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
]);

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
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
          if (file.size > MAX_AUDIO_BYTES) {
            return new Response(
              JSON.stringify({
                error: `That recording is too long — keep it under ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))} MB.`,
              }),
              { status: 413, headers: { "Content-Type": "application/json" } },
            );
          }

          const mime = (file.type || "").split(";")[0].trim().toLowerCase() || "audio/webm";
          if (!ALLOWED_AUDIO_MIME.has(mime)) {
            return new Response(
              JSON.stringify({ error: "That audio format isn't supported." }),
              { status: 415, headers: { "Content-Type": "application/json" } },
            );
          }
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

            const ep = chatCompletionsEndpoint("google/gemini-2.5-flash");
            const res = await fetch(ep.url, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${ep.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: ep.model,
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

          // English → higher-accuracy OpenAI transcribe via Lovable Gateway (falls back
          // to Gemini path above if LOVABLE_API_KEY is unavailable, e.g. self-hosted).
          const lovable = lovableOnlyEndpoint();
          if (!lovable) {
            return new Response(JSON.stringify({ error: "English transcription requires LOVABLE_API_KEY on this deployment." }), {
              status: 501, headers: { "Content-Type": "application/json" },
            });
          }
          const upstream = new FormData();
          upstream.append("model", "openai/gpt-4o-transcribe");
          upstream.append("file", file, `recording.${ext}`);
          if (language === "en") upstream.append("language", "en");

          const res = await fetch(`${lovable.baseUrl}/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${lovable.apiKey}` },
            body: upstream,
          });
          if (!res.ok) {
            const err = await res.text().catch(() => "");
            console.error("[transcribe] upstream failed", res.status, err.slice(0, 300));
            return new Response(JSON.stringify({ error: "Couldn't transcribe that. Please try again." }), {
              status: res.status, headers: { "Content-Type": "application/json" },
            });
          }
          const json = await res.json();
          const text: string = (json?.text ?? "").toString().trim();
          return new Response(JSON.stringify({ text }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("[transcribe] request failed", e);
          return new Response(JSON.stringify({ error: "Something went wrong on our side. Please try again." }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
