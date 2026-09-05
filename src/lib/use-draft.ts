/**
 * Draft preservation.
 *
 * The composer is component state, so a half-written message died the moment you
 * switched chats, opened /image, or hit a failed send (which cleared the input
 * before the request even went out). Drafts are stored per chat, so each
 * conversation keeps its own unsent message.
 *
 * Writes are debounced and skipped when nothing changed, so typing costs one
 * localStorage write per pause rather than one per keystroke.
 */

import { useEffect, useRef } from "react";
import { getDraft, setDraft } from "@/lib/chat-cache";

/** Key for the /chat landing route, which has no chat id yet. */
export const NEW_CHAT_DRAFT_KEY = "new";

const SAVE_DEBOUNCE_MS = 400;

export function useDraft(key: string, text: string, restore: (text: string) => void) {
  const restoredFor = useRef<string | null>(null);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  // Restore once per key. Declared before the save effect so it wins the first
  // pass and the save below can't overwrite a draft with the empty initial state.
  useEffect(() => {
    if (restoredFor.current === key) return;
    restoredFor.current = key;
    const saved = getDraft(key);
    if (saved) restoreRef.current(saved);
  }, [key]);

  useEffect(() => {
    if (restoredFor.current !== key) return;
    const id = setTimeout(() => setDraft(key, text), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [key, text]);
}
