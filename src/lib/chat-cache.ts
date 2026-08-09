/**
 * Client-side response caching and preferences storage.
 */

const CACHE_KEY = "manipuri_chat_cache";
const PREFS_KEY = "manipuri_user_prefs";
const MAX_CACHE_SIZE = 50;

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
