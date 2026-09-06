/**
 * Reply-language detection for "auto" mode, shared by the signed-in chat and
 * the public trial route.
 *
 * The earlier version only recognised ~45 hand-listed Meiteilon words and sent
 * everything else down the English contract, so ordinary romanized sentences
 * ("Manipur gi capital kadaida?") came back in English. This app is Meiteilon
 * first, so the default flips the other way: English is chosen only when the
 * message actually looks like English.
 */

export type ReplyLanguage = "mni" | "mni-mtei" | "en";

/** Meetei Mayek (U+ABC0–ABFF) and its extensions (U+AAE0–AAFF). */
const MEITEI_MAYEK_REGEX = /[\u{ABC0}-\u{ABFF}\u{AAE0}-\u{AAFF}]/u;

/** High-confidence romanized Meiteilon vocabulary. */
const MEITEILON_WORDS =
  /\b(khurumjari|nungairibra|nungai|kadai|kadaida|kadaino|kari|karino|karigi|karamba|kamdouna|eigi|eina|eidi|ei|nang|nangbu|nangna|nanggi|nahak|adom|adomgi|yamna|phajana|phajei|phaba|thagatchari|mateng|touba|touri|touge|toubiyu|leiri|leibra|leitre|leiba|chatpa|chatli|lakpa|laakpa|khangba|khangde|khanghanbiyu|haibiyu|haiba|haige|haibada|pambadi|oiribra|oire|oiba|natte|hoi|yare|yaroi|ngasi|hayeng|matam|thabak|yumda|imphal|chaklen|chakhao|manipurgi|meiteilon|marup|khullakpa|piyu|pibiyu|amuk|asi|adu|aduga|adubu|amasung|maram|maramdi|makhoi|mahak|eikhoi|nakhoi)\b/i;

/**
 * Meiteilon morphology: attached case markers and verb endings. These catch the
 * long tail of vocabulary the word list can never cover ("capital-gi", "-da",
 * "-dagi", "-bani"). Requires a stem so short English words don't match.
 */
const MEITEILON_SUFFIXES =
  /\b[a-z]{3,}(gi|da|ta|dagi|tagi|bu|pu|ni|bani|paani|bani|gani|khre|khini|lammi|nabagi|bagi|bada|naba|hanbiyu|jari|jage|jaba|birou|biyu|lakpa|ningi)\b/i;

/** Everyday English function words — a real English sentence has some. */
const ENGLISH_WORDS =
  /\b(the|is|are|was|were|be|been|what|which|who|whom|when|where|why|how|can|could|should|would|will|shall|do|does|did|please|thanks|thank|hello|hey|hi|ok|okay|yes|sorry|and|or|but|of|to|in|on|for|with|from|about|this|that|these|those|there|here|you|your|my|me|i|we|our|they|their|it|its|have|has|had|need|want|make|write|explain|tell|give|show|help|create|generate|between|difference|meaning|translate)\b/i;

/**
 * Decide the reply language for a message when the user left the selector on
 * "auto". Meiteilon is the fallback: this product exists to answer in Meiteilon,
 * and answering an English message in Meiteilon is a far milder failure than
 * answering a Meiteilon message in English.
 */
export function detectReplyLanguage(message: string): ReplyLanguage {
  if (MEITEI_MAYEK_REGEX.test(message)) return "mni-mtei";

  const hasMeiteilon = MEITEILON_WORDS.test(message) || MEITEILON_SUFFIXES.test(message);
  if (hasMeiteilon) return "mni";

  // No Meiteilon signal at all: English only when it reads like English.
  return ENGLISH_WORDS.test(message) ? "en" : "mni";
}

/** Applies the user's explicit choice, falling back to detection on "auto". */
export function resolveReplyLanguage(
  language: "auto" | ReplyLanguage,
  message: string,
): ReplyLanguage {
  return language === "auto" ? detectReplyLanguage(message) : language;
}
