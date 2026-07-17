import { useSyncExternalStore } from "react";

// Cross-route stream state so navigating from /chat → /chat/$chatId
// during an in-flight reply doesn't unmount the streaming UI.
export type ActiveStream = {
  chatId: string | null;
  userText: string;      // raw stored text (may contain image markdown)
  userImages: string[];  // data URLs (for the pending user bubble preview)
  streaming: string;     // partial assistant reply (grows over time)
  generatingImage: boolean;
  done: boolean;
};

let state: ActiveStream | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getActiveStream() {
  return state;
}

export function setActiveStream(next: ActiveStream | null) {
  state = next;
  emit();
}

export function updateActiveStream(patch: Partial<ActiveStream>) {
  if (!state) return;
  state = { ...state, ...patch };
  emit();
}

export function appendStreamingText(delta: string) {
  if (!state) return;
  state = { ...state, streaming: state.streaming + delta };
  emit();
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
