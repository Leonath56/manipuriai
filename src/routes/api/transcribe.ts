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

          // For Manipuri, Whisper-family models perform poorly. Route through
          // Gemini chat completions with audio input — it handles Meiteilon
          // much better and can output romanized Latin or Meitei Mayek.
          const isManipuri = language === "mni" || language === "mni-mtei";
          if (isManipuri) {
            const buf = new Uint8Array(await file.arrayBuffer());
            // base64 encode
            let bin = "";
            for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            const b64 = btoa(bin);
            const audioFmt = ext === "mp3" ? "mp3"
              : ext === "wav" ? "wav"
              : ext === "mp4" ? "m4a"
              : ext === "ogg" ? "ogg"
              : "webm";

            const script = language === "mni-mtei"
              ? "Meitei Mayek script (ꯃꯤꯇꯩ ꯃꯌꯦꯛ)"
              : "romanized Latin letters (e.g. 'Nungaithengbra')";
            const sysPrompt = `You are a precise transcriber for Meiteilon (Manipuri). Transcribe the audio EXACTLY as spoken in Manipuri using ${script}. Do NOT translate. Do NOT add commentary, quotes, or explanations. Output ONLY the transcript text. If audio is silent or unintelligible, output an empty string.`;

            const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  { role: "system", content: sysPrompt },
                  {
                    role: "user",
                    content: [
                      { type: "text", text: `Transcribe this Manipuri audio in ${script}. Output only the transcript.` },
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
