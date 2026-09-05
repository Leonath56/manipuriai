/**
 * Script detection for Meetei Mayek.
 *
 * Meetei Mayek stacks vowel signs and finals above and below the baseline, so at
 * the Latin line-height the app uses everywhere else the rows collide. The
 * stylesheet already has a `font-mayek` utility that fixes both the family and
 * the leading — but nothing in the chat surfaces was applying it, so anything a
 * user typed or received in ꯃꯤꯇꯩ ꯃꯌꯦꯛ rendered with clipped marks (and, on iOS
 * and macOS, in a fallback face that has no Meetei Mayek coverage at all).
 *
 * Detection is a plain range test — no dependency, no locale data.
 */

/** Meetei Mayek (U+ABC0–ABFF) and Meetei Mayek Extensions (U+AAE0–AAFF). */
const MAYEK_RANGE = /[\u{ABC0}-\u{ABFF}\u{AAE0}-\u{AAFF}]/u;

/** True when the text contains at least one Meetei Mayek codepoint. */
export function hasMayek(text: string): boolean {
  return MAYEK_RANGE.test(text);
}

/**
 * Classes for a container whose text may be Meetei Mayek: the Mayek family, plus
 * the taller leading pushed onto paragraphs and list items.
 *
 * The leading has to be set on the descendants, not just the container — both the
 * user bubbles and the markdown body put an explicit `leading-relaxed` /
 * `prose-p:leading-relaxed` on the paragraph, which would otherwise win over a
 * line-height inherited from the wrapper and leave the stacked marks colliding.
 *
 * Returns `undefined` rather than "" so call sites can drop it into a template
 * string without producing a stray class.
 *
 * Deliberately additive: mixed Manipuri-English text still gets the Mayek
 * leading, which is the safe direction — Latin tolerates extra line-height,
 * Mayek does not tolerate less.
 */
export function mayekClass(text: string): string | undefined {
  return hasMayek(text) ? "font-mayek [&_p]:leading-[1.9] [&_li]:leading-[1.9]" : undefined;
}

/** For a single text element (an input, a textarea) rather than a container. */
export function mayekLeading(text: string): string {
  return hasMayek(text) ? "font-mayek leading-[1.9]" : "leading-relaxed";
}
