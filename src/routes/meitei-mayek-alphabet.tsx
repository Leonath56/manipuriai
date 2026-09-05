import { createFileRoute, Link } from "@tanstack/react-router";

const TITLE = "Manipuri Alphabet — Meitei Mayek Letters Chart with Pronunciation";
const DESC =
  "Complete Manipuri alphabet chart: all 27 Meitei Mayek letters (Iyek Ipee), 8 Lonsum letters, vowel signs (Cheitap) and numerals, with romanization and pronunciation.";
const URL_ = "https://manipuriai.online/meitei-mayek-alphabet";
const OG = "https://manipuriai.online/og-image.jpg?v=6";

export const Route = createFileRoute("/meitei-mayek-alphabet")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      {
        name: "keywords",
        content:
          "manipuri alphabet, Meitei Mayek alphabet, Meitei Mayek letters, Iyek Ipee, Lonsum, Cheitap, Manipuri script chart, Manipuri letters with pronunciation",
      },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "article" },
      { property: "og:url", content: URL_ },
      { property: "og:image", content: OG },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: OG },
    ],
    links: [{ rel: "canonical", href: URL_ }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: TITLE,
          description: DESC,
          inLanguage: "en",
          mainEntityOfPage: URL_,
          author: { "@type": "Organization", name: "Manipuri AI" },
          publisher: { "@type": "Organization", name: "Manipuri AI" },
        }),
      },
    ],
  }),
  component: Page,
});

const IYEK_IPEE: [string, string, string][] = [
  ["ꯀ", "Kok", "k as in kite"],
  ["ꯁ", "Sam", "s as in sun"],
  ["ꯂ", "Lai", "l as in lamp"],
  ["ꯃ", "Mit", "m as in man"],
  ["ꯄ", "Pa", "p as in pen"],
  ["ꯅ", "Na", "n as in net"],
  ["ꯆ", "Chil", "ch as in chair"],
  ["ꯇ", "Til", "t as in tap"],
  ["ꯈ", "Khou", "kh, aspirated k"],
  ["ꯉ", "Ngou", "ng as in sing"],
  ["ꯊ", "Thou", "th, aspirated t"],
  ["ꯋ", "Wai", "w as in water"],
  ["ꯌ", "Yang", "y as in yes"],
  ["ꯍ", "Huk", "h as in hat"],
  ["ꯎ", "Un", "u as in put"],
  ["ꯏ", "Ee", "i as in machine"],
  ["ꯐ", "Pham", "ph, aspirated p"],
  ["ꯑ", "Atiya", "a as in among"],
  ["ꯒ", "Gok", "g as in go"],
  ["ꯓ", "Jham", "jh, aspirated j"],
  ["ꯔ", "Rai", "r as in run"],
  ["ꯕ", "Ba", "b as in bat"],
  ["ꯖ", "Jil", "j as in jam"],
  ["ꯗ", "Dil", "d as in dog"],
  ["ꯘ", "Ghou", "gh, aspirated g"],
  ["ꯙ", "Dhou", "dh, aspirated d"],
  ["ꯚ", "Bham", "bh, aspirated b"],
];

const LONSUM: [string, string, string][] = [
  ["ꯛ", "Kok Lonsum", "final k"],
  ["ꯜ", "Lai Lonsum", "final l"],
  ["ꯝ", "Mit Lonsum", "final m"],
  ["ꯞ", "Pa Lonsum", "final p"],
  ["ꯟ", "Na Lonsum", "final n"],
  ["ꯠ", "Til Lonsum", "final t"],
  ["ꯡ", "Ngou Lonsum", "final ng"],
  ["ꯢ", "Ee Lonsum", "final i"],
];

const CHEITAP: [string, string, string][] = [
  ["ꯥ", "Atap", "adds the long 'aa' sound"],
  ["ꯤ", "Inap", "adds the 'i' sound"],
  ["ꯨ", "Unap", "adds the 'u' sound"],
  ["ꯦ", "Yenap", "adds the 'e' sound"],
  ["ꯧ", "Sounap", "adds the 'ou' sound"],
  ["ꯩ", "Cheinap", "adds the 'ei' sound"],
  ["ꯪ", "Nung", "adds a final 'ng' nasal"],
];

const PUNCTUATION: [string, string, string][] = [
  ["꯫", "Cheikhei", "full stop / end of sentence"],
  ["꯬", "Lum Iyek", "tone mark (heavy tone)"],
  ["꯭", "Apun Iyek", "joins two consonants"],
];

const DIGITS: [string, string][] = [
  ["꯰", "0"],
  ["꯱", "1"],
  ["꯲", "2"],
  ["꯳", "3"],
  ["꯴", "4"],
  ["꯵", "5"],
  ["꯶", "6"],
  ["꯷", "7"],
  ["꯸", "8"],
  ["꯹", "9"],
];

function LetterGrid({ items }: { items: [string, string, string][] }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map(([glyph, name, sound]) => (
        <div key={name} className="rounded-xl border border-border p-3 text-center">
          <div className="text-3xl leading-none" lang="mni">
            {glyph}
          </div>
          <div className="mt-2 text-sm font-semibold">{name}</div>
          <div className="text-xs text-muted-foreground">{sound}</div>
        </div>
      ))}
    </div>
  );
}

function Page() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          The Manipuri Alphabet (Meitei Mayek) — full chart
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Meitei Mayek (ꯃꯤꯇꯩ ꯃꯌꯦꯛ) is the indigenous script of Manipuri (Meiteilon). It has{" "}
          <strong>27 main letters</strong> called <em>Iyek Ipee</em>, <strong>8 final-form letters</strong>{" "}
          called <em>Lonsum</em>, <strong>vowel signs</strong> called <em>Cheitap</em>, and its own numerals.
          Every letter is named after a part of the human body — Kok means head, Sam means hair, Mit means eye.
        </p>

        <h2 className="mt-12 text-2xl font-semibold">1. Iyek Ipee — the 27 main letters</h2>
        <p className="mt-2 text-muted-foreground">
          Each letter carries an inherent short "a" sound. Read them left to right.
        </p>
        <LetterGrid items={IYEK_IPEE} />

        <h2 className="mt-12 text-2xl font-semibold">2. Lonsum Iyek — the 8 final letters</h2>
        <p className="mt-2 text-muted-foreground">
          Lonsum letters are used at the end of a syllable, where the consonant has no vowel after it.
        </p>
        <LetterGrid items={LONSUM} />

        <h2 className="mt-12 text-2xl font-semibold">3. Cheitap Iyek — vowel signs</h2>
        <p className="mt-2 text-muted-foreground">
          Cheitap signs attach to a letter to change its vowel, the way matras work in other Indic scripts.
          For example ꯃ (ma) + ꯤ (inap) = ꯃꯤ (mi, "person").
        </p>
        <LetterGrid items={CHEITAP} />

        <h2 className="mt-12 text-2xl font-semibold">4. Punctuation and tone marks</h2>
        <LetterGrid items={PUNCTUATION} />

        <h2 className="mt-12 text-2xl font-semibold">5. Meitei Mayek numerals</h2>
        <div className="mt-4 grid grid-cols-5 gap-3">
          {DIGITS.map(([glyph, value]) => (
            <div key={value} className="rounded-xl border border-border p-3 text-center">
              <div className="text-2xl leading-none">{glyph}</div>
              <div className="mt-1 text-xs text-muted-foreground">{value}</div>
            </div>
          ))}
        </div>

        <h2 className="mt-12 text-2xl font-semibold">Try writing your first words</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
          <li>
            <strong lang="mni">ꯃꯤ</strong> — mi — person
          </li>
          <li>
            <strong lang="mni">ꯏꯃꯥ</strong> — ima — mother
          </li>
          <li>
            <strong lang="mni">ꯃꯅꯤꯄꯨꯔ</strong> — Manipur
          </li>
          <li>
            <strong lang="mni">ꯈꯨꯔꯨꯝꯖꯔꯤ</strong> — khurumjari — hello / greetings
          </li>
        </ul>

        <div className="mt-12 rounded-xl border border-border p-6">
          <h2 className="text-xl font-semibold">Practise with an AI that writes Meitei Mayek</h2>
          <p className="mt-2 text-muted-foreground">
            Type any word in English or romanized Manipuri and Manipuri AI will convert it to Meitei Mayek,
            spell it out letter by letter and correct your writing.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/try" className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">
              Try it free
            </Link>
            <Link to="/meitei-mayek-ai" className="rounded-lg border border-input px-5 py-3 font-semibold">
              Meitei Mayek AI
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            More: <Link to="/manipuri-ai" className="underline">what is Manipuri AI</Link> ·{" "}
            <Link to="/manipuri-dictionary" className="underline">Manipuri dictionary</Link> ·{" "}
            <Link to="/manipuri-translator" className="underline">Manipuri translator</Link>
          </p>
        </div>
      </article>
    </main>
  );
}
