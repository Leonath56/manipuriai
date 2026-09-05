/*
 * Shown while a Think-mode reply is being prepared (web search + reasoning),
 * before any text streams back.
 *
 * Previously: hardcoded `text-neutral-500` on `text-neutral-600` — roughly 3:1
 * against the app background, below the 4.5:1 floor for body text — with
 * `animate-pulse` on the label itself, which makes text harder to read rather
 * than communicating anything. Screen readers were told nothing at all, so the
 * wait was silent. Copy was "Analyzing Meiteilon Context..." — title-cased
 * system-speak; it now says what is happening in the app's own voice.
 */
export const ThinkingLoader = () => {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2.5 py-2 text-sm text-muted-foreground">
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gold" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gold" style={{ animationDelay: "0.15s" }} />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gold" style={{ animationDelay: "0.3s" }} />
      </span>
      <span>Thinking it through…</span>
    </div>
  );
};
