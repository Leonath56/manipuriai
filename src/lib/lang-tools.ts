/**
 * Manipuri language tasks, expressed as prompts.
 *
 * These are the jobs Meiteilon speakers actually come to a language assistant
 * for — translate, switch script, fix my writing — and the underlying model does
 * all of them today when it is asked precisely. So this is a prompt library, not
 * a translation engine: there is no offline transliteration table here and no
 * claim of one. The user sees the exact instruction that will be sent, in the
 * composer, before sending it.
 *
 * Each tool optionally pins the reply language, because the answer's language is
 * part of the task: "translate to English" that replies in Meiteilon is wrong no
 * matter how good the translation is.
 */

export type ReplyLang = "auto" | "mni" | "mni-mtei" | "en";

export type LangTool = {
  id: string;
  /** Menu label. Written as the action, so the button says what happens. */
  label: string;
  /** One line under the label. Says what you get back. */
  hint: string;
  group: "Translate" | "Script" | "Writing";
  /** Reply language this task implies, applied when the tool is used. */
  lang?: ReplyLang;
  /** Wraps the draft into the instruction that gets sent. */
  build: (text: string) => string;
};

/**
 * A fence around the user's text. Without it, a draft that itself looks like an
 * instruction ("write a poem") gets read as part of the request rather than as
 * the material to work on.
 */
function block(text: string): string {
  return `\n\n---\n${text.trim()}\n---`;
}

export const LANG_TOOLS: LangTool[] = [
  {
    id: "to-english",
    label: "Translate to English",
    hint: "Natural English, not word-for-word",
    group: "Translate",
    lang: "en",
    build: (t) =>
      "Translate the text below into natural English. Give the translation first. " +
      "If a word carries a cultural meaning that English loses, add one short note after it." +
      block(t),
  },
  {
    id: "to-manipuri",
    label: "Translate to Manipuri",
    hint: "Everyday Meiteilon in Latin letters",
    group: "Translate",
    lang: "mni",
    build: (t) =>
      "Translate the text below into natural, everyday Meiteilon (Manipuri), written in romanized " +
      "Latin letters. Use the way people actually speak, not a stiff literal rendering. " +
      "Give the translation only." +
      block(t),
  },
  {
    id: "to-mayek",
    label: "Write in Meitei Mayek",
    hint: "Same words, ꯃꯤꯇꯩ ꯃꯌꯦꯛ script",
    group: "Script",
    lang: "mni-mtei",
    build: (t) =>
      "Rewrite the text below in Meitei Mayek script (ꯃꯤꯇꯩ ꯃꯌꯦꯛ). Keep the wording and meaning " +
      "exactly as they are — change only the script. If the text is in English, translate it to " +
      "Meiteilon first, then write that in Meitei Mayek." +
      block(t),
  },
  {
    id: "to-latin",
    label: "Convert to Latin letters",
    hint: "Meitei Mayek written out in roman",
    group: "Script",
    lang: "mni",
    build: (t) =>
      "Transliterate the Meitei Mayek text below into romanized Latin letters, following how the " +
      "words are pronounced. Do not translate it — keep it in Meiteilon. Give the transliteration only." +
      block(t),
  },
  {
    id: "fix-writing",
    label: "Fix my writing",
    hint: "Corrected version, then what changed",
    group: "Writing",
    build: (t) =>
      "Correct the spelling and grammar of the text below. Keep my meaning and my voice — do not " +
      "rewrite it into something more formal than I wrote. Give the corrected text first, then a " +
      "short list of what you changed and why." +
      block(t),
  },
  {
    id: "make-formal",
    label: "Make it polite and formal",
    hint: "For letters, applications, messages to elders",
    group: "Writing",
    build: (t) =>
      "Rewrite the text below as a polite, formal message, in the same language it is written in. " +
      "Use the honorific forms a Meiteilon speaker would use when writing to an elder or an office. " +
      "Give the rewritten version only." +
      block(t),
  },
  {
    id: "explain-grammar",
    label: "Explain the grammar",
    hint: "Word by word, with the suffixes broken out",
    group: "Writing",
    build: (t) =>
      "Explain the grammar of the Meiteilon text below for a learner. Break each word into its root " +
      "and suffixes, say what each suffix does, then give the sentence's literal and natural meanings. " +
      "Answer in English." +
      block(t),
  },
];

export const LANG_TOOL_GROUPS = ["Translate", "Script", "Writing"] as const;
