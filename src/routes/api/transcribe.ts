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

          const upstream = new FormData();
          upstream.append("model", "openai/gpt-4o-mini-transcribe");
          // Pick extension from mime
          const mime = (file.type || "").split(";")[0];
          const ext = mime === "audio/mp4" ? "mp4"
            : mime === "audio/mpeg" ? "mp3"
            : mime === "audio/wav" || mime === "audio/wave" ? "wav"
            : mime === "audio/ogg" ? "ogg"
            : "webm";
          upstream.append("file", file, `recording.${ext}`);
          // Language hints: mni-mtei / mni → "mni" (Meiteilon ISO 639-1 not standardized); auto = omit
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
