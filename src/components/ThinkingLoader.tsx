import { ChatResponseSkeleton } from "@/components/skeletons";

/*
 * Shown while a reply is being prepared, before any text streams back.
 *
 * It now renders a response-shaped skeleton in the exact place the answer will
 * appear — same column, same line height — so the swap to real text does not
 * move the page. A quiet status line keeps the wait legible for screen readers
 * and for anyone with motion reduced.
 */
export const ThinkingLoader = () => {
  return (
    <div role="status" aria-live="polite" className="w-full">
      <span className="sr-only">Preparing a reply</span>
      <div className="flex items-center gap-2.5 pb-2 text-sm text-muted-foreground">
        <span aria-hidden="true" className="flex items-center gap-1">
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gold" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gold" style={{ animationDelay: "0.15s" }} />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gold" style={{ animationDelay: "0.3s" }} />
        </span>
        <span aria-hidden="true">Thinking it through…</span>
      </div>
      <ChatResponseSkeleton />
    </div>
  );
};
