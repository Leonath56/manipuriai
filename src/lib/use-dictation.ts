/**
 * Push-to-talk dictation for the composer.
 *
 * The app already had speech-to-text — `/api/transcribe`, which routes Meiteilon
 * through Gemini because Whisper-family models handle it badly — but the only
 * caller was the full-screen /voice route. So the one thing that makes typing
 * Manipuri hard (no comfortable keyboard for either script) had a fix that you
 * could only reach by leaving the conversation.
 *
 * This is the same endpoint, wired to a mic button in the composer: hold a
 * thought, speak it, get editable text in the input. No new service, no new
 * dependency, and no extra cost beyond the transcription /voice already pays for.
 *
 * Deliberately simpler than /voice: press to start, press to stop. No voice
 * activity detection, no AudioContext analyser and no animation frame loop —
 * dictation ends when the user says it ends.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { preprocessAudio } from "@/lib/audio-preprocess";

export type DictationState = "idle" | "recording" | "transcribing";

/** Hard stop, so a forgotten open mic can't upload an hour of room noise. */
const MAX_RECORDING_MS = 90_000;

export function useDictation(opts: {
  /** Reply-language pill value; picks the transcription path server-side. */
  language: "auto" | "mni" | "mni-mtei" | "en";
  /** Receives the transcript. Called only on success with non-empty text. */
  onText: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const [state, setState] = useState<DictationState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set when the user cancels: the blob is then dropped, not transcribed. */
  const cancelledRef = useRef(false);

  // Latest-value refs so the callbacks below don't need to be rebuilt (and the
  // recorder's onstop closure can't capture a stale language).
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const releaseMic = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Never leave the mic hot after a route change.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      try {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      } catch {
        // Already torn down.
      }
      releaseMic();
    };
  }, [releaseMic]);

  const transcribe = useCallback(async (blob: Blob) => {
    setState("transcribing");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      // The endpoint requires a bearer token and scopes to that user; there is
      // no anonymous transcription path to fall back to.
      if (!token) throw new Error("Please sign in again to use the microphone.");

      const processed = await preprocessAudio(blob);
      const ext = processed.type.includes("wav")
        ? "wav"
        : blob.type.includes("mp4")
          ? "mp4"
          : blob.type.includes("mpeg")
            ? "mp3"
            : "webm";

      const fd = new FormData();
      fd.append("file", processed, `dictation.${ext}`);
      fd.append("language", optsRef.current.language);

      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);

      const text = (json.text ?? "").trim();
      if (!text) throw new Error("Didn't catch that — try again a little closer to the mic.");
      optsRef.current.onText(text);
    } catch (e) {
      optsRef.current.onError?.(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setState("idle");
    }
  }, []);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
      const mime = candidates.find(
        (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
      );
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        releaseMic();
        if (cancelledRef.current) {
          setState("idle");
          return;
        }
        // Roughly a quarter-second of audio. Below that it's a mis-tap, and the
        // endpoint would reject it anyway — don't spend a request on it.
        if (blob.size < 2048) {
          setState("idle");
          return;
        }
        void transcribe(blob);
      };

      rec.start();
      setState("recording");
      timeoutRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      }, MAX_RECORDING_MS);
    } catch (e) {
      releaseMic();
      setState("idle");
      const msg =
        e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
          ? "Microphone access was blocked. Allow it in your browser settings to dictate."
          : e instanceof DOMException && e.name === "NotFoundError"
            ? "No microphone found."
            : e instanceof Error
              ? e.message
              : "Couldn't start the microphone";
      optsRef.current.onError?.(msg);
    }
  }, [releaseMic, state, transcribe]);

  /** Stops and transcribes. */
  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  /** Stops and throws the audio away. */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else {
      releaseMic();
      setState("idle");
    }
  }, [releaseMic]);

  return { state, start, stop, cancel };
}
