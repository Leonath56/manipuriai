import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { X, Loader2 } from "lucide-react";
import { streamChat } from "@/lib/chat-stream";
import { useServerFn } from "@tanstack/react-start";
import { synthesizeSpeech } from "@/lib/tts.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/voice")({
  head: () => ({ meta: [{ title: "Voice — Manipuri AI" }] }),
  component: VoiceMode,
});

type Status = "idle" | "listening" | "thinking" | "speaking";
type Lang = "auto" | "mni" | "mni-mtei" | "en";

// Strip markdown/images for TTS
function cleanForTts(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3500);
}

function VoiceMode() {
  const navigate = useNavigate();
  const tts = useServerFn(synthesizeSpeech);

  const [status, setStatus] = useState<Status>("idle");
  const [lang, setLang] = useState<Lang>("auto");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [level, setLevel] = useState(0); // 0..1 for orb pulse
  const [error, setError] = useState<string | null>(null);

  const chatIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const spokeRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const langRef = useRef<Lang>("auto");
  useEffect(() => { langRef.current = lang; }, [lang]);

  const cleanupMic = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    setLevel(0);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (audioElRef.current) {
      try { audioElRef.current.pause(); } catch { /* ignore */ }
      audioElRef.current.src = "";
      audioElRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const startListening = useCallback(async () => {
    if (stoppedRef.current) return;
    setError(null);
    setTranscript("");
    setReply("");
    stopSpeaking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Pick a supported mime
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
      const mime = candidates.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) || "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        cleanupMic();
        if (!spokeRef.current || blob.size < 2048) {
          if (!stoppedRef.current) startListening();
          return;
        }
        await handleAudio(blob);
      };
      rec.start();
      setStatus("listening");
      spokeRef.current = false;
      silenceStartRef.current = null;

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 4));

        const SPEAK_THRESHOLD = 0.04;
        const SILENCE_MS = 1400;
        const now = performance.now();
        if (rms > SPEAK_THRESHOLD) {
          spokeRef.current = true;
          silenceStartRef.current = null;
        } else if (spokeRef.current) {
          if (silenceStartRef.current === null) silenceStartRef.current = now;
          else if (now - silenceStartRef.current > SILENCE_MS) {
            if (recorderRef.current && recorderRef.current.state === "recording") {
              recorderRef.current.stop();
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Microphone error";
      setError(msg);
      setStatus("idle");
      cleanupMic();
    }
  }, [cleanupMic, stopSpeaking]);

  const handleAudio = useCallback(async (blob: Blob) => {
    setStatus("thinking");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Not signed in");

      const fd = new FormData();
      const ext = (blob.type.includes("mp4") ? "mp4" : blob.type.includes("mpeg") ? "mp3" : "webm");
      fd.append("file", blob, `recording.${ext}`);
      fd.append("language", langRef.current);
      const tRes = await fetch("/api/transcribe", {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
      });
      const tJson = await tRes.json().catch(() => ({}));
      if (!tRes.ok) throw new Error(tJson.error || `Transcribe failed (${tRes.status})`);
      const userText: string = (tJson.text ?? "").trim();
      if (!userText) {
        // nothing heard, listen again
        if (!stoppedRef.current) startListening();
        return;
      }
      setTranscript(userText);

      abortRef.current = new AbortController();
      let acc = "";
      const { reply: full } = await streamChat({
        chatId: chatIdRef.current,
        message: userText,
        language: langRef.current,
        mode: "instant",
        signal: abortRef.current.signal,
        onMeta: (m) => { chatIdRef.current = m.chatId; },
        onChunk: (d) => { acc += d; setReply(acc); },
      });
      const speak = cleanForTts(full || acc);
      if (!speak) {
        if (!stoppedRef.current) startListening();
        return;
      }
      setStatus("speaking");
      const audio = await tts({ data: { text: speak } });
      if (stoppedRef.current) return;
      const bytes = Uint8Array.from(atob(audio.audio), (c) => c.charCodeAt(0));
      const b = new Blob([bytes], { type: audio.mime });
      const url = URL.createObjectURL(b);
      audioUrlRef.current = url;
      const el = new Audio(url);
      audioElRef.current = el;
      el.onended = () => {
        stopSpeaking();
        if (!stoppedRef.current) startListening();
      };
      el.onerror = () => {
        stopSpeaking();
        if (!stoppedRef.current) startListening();
      };
      await el.play().catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setError(msg);
      toast.error(msg);
      setStatus("idle");
      // Auto-recover: try to listen again after a small delay
      setTimeout(() => { if (!stoppedRef.current) startListening(); }, 800);
    }
  }, [startListening, stopSpeaking, tts]);

  // Auto-start on mount
  useEffect(() => {
    stoppedRef.current = false;
    startListening();
    return () => {
      stoppedRef.current = true;
      abortRef.current?.abort();
      cleanupMic();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOrbTap = () => {
    if (status === "speaking") {
      // Interrupt AI and start listening again
      stopSpeaking();
      startListening();
    } else if (status === "listening") {
      // Force submit whatever we have
      if (recorderRef.current && recorderRef.current.state === "recording") {
        spokeRef.current = true; // force submit
        recorderRef.current.stop();
      }
    } else if (status === "thinking") {
      // Cancel generation
      abortRef.current?.abort();
      setStatus("idle");
      setTimeout(() => { if (!stoppedRef.current) startListening(); }, 100);
    } else {
      startListening();
    }
  };

  const exit = () => {
    stoppedRef.current = true;
    abortRef.current?.abort();
    cleanupMic();
    stopSpeaking();
    if (chatIdRef.current) navigate({ to: "/chat/$chatId", params: { chatId: chatIdRef.current } });
    else navigate({ to: "/chat" });
  };

  const statusLabel =
    status === "listening" ? "Listening…" :
    status === "thinking" ? "Thinking…" :
    status === "speaking" ? "Speaking… (tap to interrupt)" :
    "Tap to start";

  const scale = 1 + (status === "listening" ? level * 0.6 : status === "speaking" ? 0.15 : 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-neutral-950 to-black text-white">
      <div className="flex items-center justify-between p-4">
        <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
          <SelectTrigger className="h-9 w-auto gap-1.5 border-white/20 bg-white/5 px-3 text-xs text-white hover:bg-white/10">
            <span>
              {lang === "auto" ? "Auto" : lang === "mni" ? "Manipuri" : lang === "mni-mtei" ? "Mayek ꯃ" : "English"}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            <SelectItem value="mni">Manipuri (Latin)</SelectItem>
            <SelectItem value="mni-mtei">Manipuri (Meitei Mayek)</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={exit} className="text-white hover:bg-white/10" aria-label="Exit voice mode">
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
        <button
          type="button"
          onClick={onOrbTap}
          className="relative flex h-56 w-56 items-center justify-center rounded-full outline-none focus:ring-2 focus:ring-white/40"
          aria-label="Voice orb"
        >
          <span
            className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-300 via-emerald-500 to-emerald-700 opacity-70 blur-2xl transition-transform duration-150"
            style={{ transform: `scale(${scale})` }}
          />
          <span
            className="absolute inset-6 rounded-full bg-gradient-to-br from-white/90 to-emerald-200 shadow-2xl transition-transform duration-150"
            style={{ transform: `scale(${scale * 0.95})` }}
          />
          <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-black/80 text-white">
            {status === "thinking" ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <span
                className="font-serif text-5xl leading-none text-emerald-100"
                style={{
                  textShadow:
                    "0 0 12px rgba(16,185,129,0.9), 0 0 28px rgba(16,185,129,0.7), 0 0 48px rgba(52,211,153,0.5)",
                }}
                aria-hidden
              >
                ꯃ
              </span>
            )}
          </span>
          {status === "listening" && (
            <span className="absolute inset-0 animate-ping rounded-full border border-white/30" />
          )}
        </button>

        <div className="min-h-[3rem] text-center">
          <p className="text-sm uppercase tracking-widest text-white/70">{statusLabel}</p>
          {transcript && (
            <p className="mt-3 max-w-md text-base text-white/90">“{transcript}”</p>
          )}
          {reply && status !== "listening" && (
            <p className="mt-2 max-w-xl text-sm text-white/60 line-clamp-3">{reply}</p>
          )}
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>
      </div>

      <p className="pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center text-[10px] text-white/40">
        Manipuri AI Voice · Tap orb to interrupt · DEVELOPED BY LEONATH
      </p>
    </div>
  );
}
