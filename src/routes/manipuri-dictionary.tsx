import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/manipuri-dictionary")({
  head: () => ({
    meta: [
      { title: "Manipuri Dictionary — Meiteilon ⇄ English Word Meanings" },
      {
        name: "description",
        content:
          "Free Manipuri (Meiteilon) dictionary with English meanings, romanized spelling and Meitei Mayek script. Search everyday words, greetings, numbers, family terms and food words.",
      },
      {
        name: "keywords",
        content:
          "Manipuri dictionary, Meiteilon dictionary, Manipuri words with meaning, Manipuri to English dictionary, Meitei Mayek words, Manipuri vocabulary",
      },
      { property: "og:title", content: "Manipuri Dictionary — Meiteilon ⇄ English Word Meanings" },
      {
        property: "og:description",
        content:
          "Search Manipuri (Meiteilon) words with English meanings, romanization and Meitei Mayek script. Free and AI-powered.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://manipuriai.online/manipuri-dictionary" },
      { property: "og:image", content: "https://manipuriai.online/og-image.jpg?v=6" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Manipuri Dictionary — Meiteilon ⇄ English" },
      {
        name: "twitter:description",
        content: "Manipuri (Meiteilon) words with English meanings, romanization and Meitei Mayek script.",
      },
      { name: "twitter:image", content: "https://manipuriai.online/og-image.jpg?v=6" },
    ],
    links: [{ rel: "canonical", href: "https://manipuriai.online/manipuri-dictionary" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "DefinedTermSet",
          name: "Manipuri (Meiteilon) Dictionary",
          url: "https://manipuriai.online/manipuri-dictionary",
          inDefinedTermSet: "https://manipuriai.online/manipuri-dictionary",
          description:
            "Manipuri (Meiteilon) words with English meanings, romanized spelling and Meitei Mayek script.",
        }),
      },
    ],
  }),
  component: Page,
});

type Entry = { roman: string; mayek: string; english: string; group: string };

const ENTRIES: Entry[] = [
  // Greetings & courtesy
  { roman: "Khurumjari", mayek: "ꯈꯨꯔꯨꯝꯖꯔꯤ", english: "Hello / greetings (respectful)", group: "Greetings" },
  { roman: "Thagatchari", mayek: "ꯊꯥꯒꯠꯆꯔꯤ", english: "Thank you", group: "Greetings" },
  { roman: "Nungaiba", mayek: "ꯅꯨꯡꯉꯥꯏꯕ", english: "To be happy / glad", group: "Greetings" },
  { roman: "Chatchare", mayek: "ꯆꯠꯆꯔꯦ", english: "I am leaving / goodbye", group: "Greetings" },
  // People & family
  { roman: "Ima", mayek: "ꯏꯃ", english: "Mother", group: "Family" },
  { roman: "Ipa", mayek: "ꯏꯄ", english: "Father", group: "Family" },
  { roman: "Ichan", mayek: "ꯏꯆꯟ", english: "Younger sibling", group: "Family" },
  { roman: "Mapa", mayek: "ꯃꯄ", english: "His / her father", group: "Family" },
  { roman: "Nupi", mayek: "ꯅꯨꯄꯤ", english: "Woman", group: "Family" },
  { roman: "Nupa", mayek: "ꯅꯨꯄ", english: "Man", group: "Family" },
  { roman: "Angang", mayek: "ꯑꯉꯥꯡ", english: "Child", group: "Family" },
  // Numbers
  { roman: "Ama", mayek: "ꯑꯃ", english: "One (1)", group: "Numbers" },
  { roman: "Ani", mayek: "ꯑꯅꯤ", english: "Two (2)", group: "Numbers" },
  { roman: "Ahum", mayek: "ꯑꯍꯨꯝ", english: "Three (3)", group: "Numbers" },
  { roman: "Mari", mayek: "ꯃꯔꯤ", english: "Four (4)", group: "Numbers" },
  { roman: "Manga", mayek: "ꯃꯉꯥ", english: "Five (5)", group: "Numbers" },
  { roman: "Taruk", mayek: "ꯇꯔꯨꯛ", english: "Six (6)", group: "Numbers" },
  { roman: "Taret", mayek: "ꯇꯔꯦꯠ", english: "Seven (7)", group: "Numbers" },
  { roman: "Nipal", mayek: "ꯅꯤꯄꯥꯜ", english: "Eight (8)", group: "Numbers" },
  { roman: "Mapal", mayek: "ꯃꯥꯄꯜ", english: "Nine (9)", group: "Numbers" },
  { roman: "Tara", mayek: "ꯇꯔ", english: "Ten (10)", group: "Numbers" },
  // Everyday things
  { roman: "Chak", mayek: "ꯆꯥꯛ", english: "Cooked rice / meal", group: "Food" },
  { roman: "Ising", mayek: "ꯏꯁꯤꯡ", english: "Water", group: "Food" },
  { roman: "Nga", mayek: "ꯉ", english: "Fish", group: "Food" },
  { roman: "Yen", mayek: "ꯌꯦꯟ", english: "Chicken", group: "Food" },
  { roman: "Utong", mayek: "ꯎꯇꯣꯡ", english: "Bamboo tube", group: "Food" },
  { roman: "Singju", mayek: "ꯁꯤꯡꯖꯨ", english: "Traditional Manipuri salad", group: "Food" },
  // Nature & time
  { roman: "Numit", mayek: "ꯅꯨꯃꯤꯠ", english: "Sun / day", group: "Nature & time" },
  { roman: "Tha", mayek: "ꯊꯥ", english: "Moon / month", group: "Nature & time" },
  { roman: "Nong", mayek: "ꯅꯣꯡ", english: "Rain / sky", group: "Nature & time" },
  { roman: "Ching", mayek: "ꯆꯤꯡ", english: "Hill / mountain", group: "Nature & time" },
  { roman: "Pat", mayek: "ꯄꯥꯠ", english: "Lake", group: "Nature & time" },
  { roman: "Ngasi", mayek: "ꯉꯁꯤ", english: "Today", group: "Nature & time" },
  { roman: "Hayeng", mayek: "ꯍꯌꯦꯡ", english: "Tomorrow", group: "Nature & time" },
  { roman: "Ngarang", mayek: "ꯉꯔꯥꯡ", english: "Yesterday", group: "Nature & time" },
  // Common verbs & adjectives
  { roman: "Chaba", mayek: "ꯆꯥꯕ", english: "To eat", group: "Verbs & adjectives" },
  { roman: "Thakpa", mayek: "ꯊꯛꯄ", english: "To drink", group: "Verbs & adjectives" },
  { roman: "Chatpa", mayek: "ꯆꯠꯄ", english: "To go", group: "Verbs & adjectives" },
  { roman: "Laakpa", mayek: "ꯂꯥꯛꯄ", english: "To come", group: "Verbs & adjectives" },
  { roman: "Tamba", mayek: "ꯇꯝꯕ", english: "To learn", group: "Verbs & adjectives" },
  { roman: "Phaba", mayek: "ꯐꯥꯕ", english: "To catch / obtain", group: "Verbs & adjectives" },
  { roman: "Aphaba", mayek: "ꯑꯐꯕ", english: "Good", group: "Verbs & adjectives" },
  { roman: "Phattaba", mayek: "ꯐꯠꯇꯕ", english: "Bad", group: "Verbs & adjectives" },
  { roman: "Achouba", mayek: "ꯑꯆꯧꯕ", english: "Big", group: "Verbs & adjectives" },
  { roman: "Apikpa", mayek: "ꯑꯄꯤꯛꯄ", english: "Small", group: "Verbs & adjectives" },
  // Language & culture
  { roman: "Lairik", mayek: "ꯂꯥꯏꯔꯤꯛ", english: "Book", group: "Language & culture" },
  { roman: "Wahei", mayek: "ꯋꯥꯍꯩ", english: "Word", group: "Language & culture" },
  { roman: "Lon", mayek: "ꯂꯣꯟ", english: "Language", group: "Language & culture" },
  { roman: "Meitei Mayek", mayek: "ꯃꯤꯇꯩ ꯃꯌꯦꯛ", english: "The Meitei script", group: "Language & culture" },
  { roman: "Sana Leibak", mayek: "ꯁꯅ ꯂꯩꯕꯥꯛ", english: "Golden land (poetic name for Manipur)", group: "Language & culture" },
];

const GROUPS = Array.from(new Set(ENTRIES.map((e) => e.group)));

function Page() {
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return ENTRIES;
    return ENTRIES.filter(
      (e) =>
        e.roman.toLowerCase().includes(term) ||
        e.english.toLowerCase().includes(term) ||
        e.mayek.includes(q.trim()),
    );
  }, [q]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Manipuri Dictionary</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Look up <strong>Manipuri (Meiteilon)</strong> words with their English meanings, romanized spelling and
          Meitei Mayek script (ꯃꯤꯇꯩ ꯃꯌꯦꯛ). Search below, or ask Manipuri AI for any word that isn&apos;t listed —
          it explains meanings, usage and example sentences in both languages.
        </p>

        <label htmlFor="dict-search" className="sr-only">
          Search Manipuri or English words
        </label>
        <input
          id="dict-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a word — e.g. chak, water, ꯏꯁꯤꯡ"
          className="mt-8 w-full rounded-lg border border-input bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted-foreground focus:border-ring"
        />

        <p className="mt-3 text-sm text-muted-foreground">
          {results.length} {results.length === 1 ? "word" : "words"}
        </p>

        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Manipuri (romanized)</th>
                <th scope="col" className="px-4 py-3 font-medium">Meitei Mayek</th>
                <th scope="col" className="px-4 py-3 font-medium">English meaning</th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Category</th>
              </tr>
            </thead>
            <tbody>
              {results.map((e) => (
                <tr key={e.roman} className="border-t border-border/60">
                  <td className="px-4 py-3 font-medium">{e.roman}</td>
                  <td className="px-4 py-3 text-lg">{e.mayek}</td>
                  <td className="px-4 py-3 text-muted-foreground">{e.english}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{e.group}</td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr className="border-t border-border/60">
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    No match here — ask Manipuri AI for this word instead.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h2 className="mt-12 text-2xl font-semibold">Categories covered</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-muted-foreground">
          {GROUPS.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>

        <h2 className="mt-12 text-2xl font-semibold">Beyond the word list</h2>
        <p className="mt-3 text-muted-foreground">
          A fixed list can never cover a living language. Manipuri AI handles the rest: word meanings in context,
          honorific forms, SOV sentence construction, and conversion between romanized Manipuri, Bengali script and
          Meitei Mayek. Ask something like <em>&quot;what does &lsquo;nungshiba&rsquo; mean and how do I use it in a
          sentence?&quot;</em>
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link to="/try" className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">
            Ask about any word — free
          </Link>
          <Link to="/manipuri-translator" className="rounded-lg border border-input px-5 py-3 font-semibold">
            Manipuri translator
          </Link>
          <Link to="/meitei-mayek-ai" className="rounded-lg border border-input px-5 py-3 font-semibold">
            Meitei Mayek AI
          </Link>
        </div>
      </article>
    </main>
  );
}
