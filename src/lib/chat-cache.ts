/**
 * Client-side response caching and preferences storage.
 */

const CACHE_KEY = "manipuri_chat_cache";
const PREFS_KEY = "manipuri_user_prefs";
const DRAFT_KEY = "manipuri_drafts";
const MAX_CACHE_SIZE = 50;
/** Enough for a long message; stops one runaway paste from filling the quota. */
const MAX_DRAFT_CHARS = 8000;
/** Drafts are a convenience, not an archive. Oldest are dropped past this. */
const MAX_DRAFTS = 20;

type CacheEntry = {
  prompt: string;
  response: string;
  timestamp: number;
};

type UserPrefs = {
  lang: "auto" | "mni" | "mni-mtei" | "en";
  mode: "instant" | "think";
  theme?: string;
};

/**
 * Normalizes a prompt for cache lookup.
 */
function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().trim();
}

/**
 * Gets a cached response if available.
 */
export function getCachedResponse(prompt: string): string | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache: CacheEntry[] = JSON.parse(raw);
    const key = normalizePrompt(prompt);
    const entry = cache.find((e) => normalizePrompt(e.prompt) === key);
    return entry ? entry.response : null;
  } catch (e) {
    console.error("Cache read failed", e);
    return null;
  }
}

/**
 * Saves a prompt-response pair to the cache.
 *
 * No longer called. Both read sites were switched off deliberately — replaying a
 * cached reply for a repeated prompt ignores the conversation it sits in — but
 * the writes were left running, so every reply was still being copied into
 * localStorage where nothing would ever read it: up to 50 full replies of quota,
 * and of the user's conversation content, spent on nothing. Kept alongside the
 * read path in case prompt caching is revived.
 */
export function setCachedResponse(prompt: string, response: string): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    let cache: CacheEntry[] = raw ? JSON.parse(raw) : [];
    const key = normalizePrompt(prompt);
    
    // Remove old entry if exists
    cache = cache.filter((e) => normalizePrompt(e.prompt) !== key);
    
    // Add new entry at the beginning
    cache.unshift({ prompt, response, timestamp: Date.now() });
    
    // Limit size
    if (cache.length > MAX_CACHE_SIZE) {
      cache = cache.slice(0, MAX_CACHE_SIZE);
    }
    
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error("Cache write failed", e);
  }
}

/**
 * Gets stored user preferences.
 */
export function getUserPrefs(): UserPrefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Updates user preferences.
 */
export function setUserPrefs(prefs: Partial<UserPrefs>): void {
  try {
    const existing = getUserPrefs() || { lang: "auto", mode: "instant" };
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...existing, ...prefs }));
  } catch (e) {
    console.error("Prefs write failed", e);
  }
}

/* ============================ Draft preservation ============================
 *
 * Typing a long message, navigating to another chat and coming back lost the
 * whole thing — the composer is plain component state, so it died with the
 * route. Worse, a failed send had already cleared it.
 *
 * Drafts are keyed per chat ("new" for the /chat landing route) so switching
 * between conversations keeps each one's half-written message. Text only:
 * attachments are data URLs, and persisting a few megabytes of base64 per draft
 * would blow the storage quota for no real gain.
 */

type DraftMap = Record<string, { text: string; at: number }>;

function readDrafts(): DraftMap {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as DraftMap) : {};
  } catch {
    return {};
  }
}

function writeDrafts(map: DraftMap): void {
  try {
    if (typeof localStorage === "undefined") return;
    let entries = Object.entries(map);
    if (entries.length > MAX_DRAFTS) {
      entries = entries.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_DRAFTS);
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Quota or private-mode failure. A lost draft is not worth a thrown error.
  }
}

/** The unsent message for a chat, or "" when there isn't one. */
export function getDraft(key: string): string {
  const d = readDrafts()[key];
  return d?.text ?? "";
}

/** Stores (or, for empty text, removes) the draft for a chat. */
export function setDraft(key: string, text: string): void {
  const map = readDrafts();
  const trimmed = text.slice(0, MAX_DRAFT_CHARS);
  if (!trimmed.trim()) {
    if (!(key in map)) return; // nothing to do — skip the write entirely
    delete map[key];
  } else {
    if (map[key]?.text === trimmed) return;
    map[key] = { text: trimmed, at: Date.now() };
  }
  writeDrafts(map);
}

/** Called once a message is actually on its way. */
export function clearDraft(key: string): void {
  setDraft(key, "");
}

/**
 * Drops the write-only response cache described above. Drafts share the same
 * origin quota, and reclaiming space that held nothing readable is worth one
 * `getItem` per session.
 */
export function purgeLegacyResponseCache(): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(CACHE_KEY) !== null) localStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage unavailable. Nothing to clean up.
  }
}

/**
 * Wipes everything this module keeps in localStorage. Call on sign-out.
 *
 * Drafts are keyed by chat id, not by account, so on a shared browser the next
 * person to sign in inherited the previous person's unsent message text — the
 * server-side isolation is sound, but the composer restored a draft that was
 * never theirs. Preferences leak far less, and go with them.
 */
export function clearLocalUserData(): void {
  try {
    if (typeof localStorage === "undefined") return;
    for (const key of [DRAFT_KEY, PREFS_KEY, CACHE_KEY]) localStorage.removeItem(key);
  } catch {
    // Storage unavailable — nothing was written, so nothing to clear.
  }
}
