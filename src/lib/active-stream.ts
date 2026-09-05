import { useSyncExternalStore } from "react";

// Cross-route stream state so navigating from /chat → /chat/$chatId
// during an in-flight reply doesn't unmount the streaming UI.
export type ActiveStream = {
  chatId: string | null;
  timestamp: number;     // Unique identifier for the turn to prevent deduplication
  userText: string;      // raw stored text (may contain image markdown)
  userImages: string[];  // data URLs (for the pending user bubble preview)
  streaming: string;     // partial assistant reply (grows over time)
  generatingImage: boolean;
  done: boolean;
  baseCount: number;     // persisted DB row count when this turn started

};

let state: ActiveStream | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/**
 * Text deltas arrive faster than the screen refreshes, so notifying on every one
 * just queues renders that are thrown away. Growth is coalesced into the next
 * animation frame; lifecycle changes (start/done/clear) still emit immediately
 * because correctness depends on them, not on how they look.
 */
let growthFrame: number | null = null;

function cancelPendingGrowth() {
  if (growthFrame === null) return;
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(growthFrame);
  else clearTimeout(growthFrame as unknown as ReturnType<typeof setTimeout>);
  growthFrame = null;
}

function emitCoalesced() {
  if (growthFrame !== null) return;
  // No rAF during SSR or in a background tab that never paints — fall back to a
  // timer so text still lands.
  if (typeof requestAnimationFrame !== "function") {
    growthFrame = setTimeout(() => {
      growthFrame = null;
      emit();
    }, 16) as unknown as number;
    return;
  }
  growthFrame = requestAnimationFrame(() => {
    growthFrame = null;
    emit();
  });
}

export function getActiveStream() {
  return state;
}

export function setActiveStream(next: ActiveStream | null) {
  // Drop any queued growth notification for the turn being replaced.
  cancelPendingGrowth();
  state = next;
  emit();
}

export function updateActiveStream(patch: Partial<ActiveStream>) {
  if (!state) return;
  state = { ...state, ...patch };
  // Flush immediately: `done` gates the carryover handoff and must not sit in a
  // frame queue behind pending text.
  cancelPendingGrowth();
  emit();
}

export function appendStreamingText(delta: string) {
  if (!state) return;
  state = { ...state, streaming: state.streaming + delta };
  emitCoalesced();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// SSR-safe snapshot (server has no active stream)
const serverSnapshot = () => null as ActiveStream | null;

export function useActiveStream(): ActiveStream | null {
  return useSyncExternalStore(subscribe, () => state, serverSnapshot);
}
