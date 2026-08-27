import { createFileRoute, Link } from "@tanstack/react-router";

const TITLE = "Manipuri AI — Free Meiteilon Chatbot, Translator & Voice AI";
const DESC =
  "Manipuri AI is a free AI chatbot for Manipuri (Meiteilon) and English. Chat in Meitei Mayek or romanized Manipuri, translate, learn words, use voice mode and generate images.";
const URL_ = "https://manipuriai.online/manipuri-ai";
const OG = "https://manipuriai.online/og-image.jpg?v=6";

export const Route = createFileRoute("/manipuri-ai")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      {
        name: "keywords",
        content:
          "Manipuri AI, Manipur AI, Meiteilon AI, Manipuri chatbot, Manipuri artificial intelligence, AI in Manipuri language, Manipuri ChatGPT",
      },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
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
          "@type": "SoftwareApplication",
          name: "Manipuri AI",
          url: URL_,
          applicationCategory: "UtilitiesApplication",
          operatingSystem: "Web",
          inLanguage: ["mni", "en"],
          description: DESC,
          offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
        }),
      },
    ],
  }),
  component: Page,
});

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Manipuri AI?",
    a: "Manipuri AI is an AI assistant built for Meiteilon (Manipuri) and English. It understands Meitei Mayek script, romanized Manipuri, Bengali-script Manipuri and mixed Manipuri-English typing, and replies in the same style you write.",
  },
  {
    q: "Is Manipuri AI free?",
    a: "Yes. You can chat free without an account on the trial page, and a free account gives you saved chat history. Paid plans add voice mode, image generation and higher limits.",
  },
  {
    q: "Can it translate Manipuri to English?",
    a: "Yes — paste any Manipuri sentence and ask for the English meaning, or the other way round. It also explains grammar and gives word-by-word breakdowns.",
  },
  {
    q: "Does it work on a phone?",
    a: "Yes. Manipuri AI runs in any mobile browser with no install, and supports voice input for hands-free use.",
  },
  {
    q: "Can it do coding and maths too?",
    a: "Yes. Beyond language, it handles coding, mathematics, study help and general questions — and can explain the answer in Manipuri.",
  },
];

function Page() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Manipuri AI — the AI that speaks Meiteilon
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Manipuri AI (ꯃꯅꯤꯄꯨꯔꯤ AI) is a free AI chatbot made for Manipur. Write in{" "}
          <strong>Meitei Mayek</strong>, romanized Manipuri, English, or a natural mix of Manipuri and
          English — it understands all of them and answers in the same style.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/try" className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">
            Chat free — no signup
          </Link>
          <Link to="/auth" className="rounded-lg border border-input px-5 py-3 font-semibold">
            Create free account
          </Link>
        </div>

        <h2 className="mt-12 text-2xl font-semibold">Why a Manipuri-specific AI?</h2>
        <p className="mt-3 text-muted-foreground">
          General AI tools treat Meiteilon as an afterthought: they garble Meitei Mayek characters, use
          Bengali or Hindi word order, and invent words that no one in Imphal actually says. Manipuri AI is
          tuned for Meiteilon sentence structure (subject–object–verb), native vocabulary, honorifics and
          everyday romanization, so replies read like a person from Manipur wrote them.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">What you can do with it</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
          <li>
            <strong>Chat naturally</strong> — ask anything in Manipuri, English, or both in one sentence.
          </li>
          <li>
            <strong>Translate</strong> Manipuri ⇄ English with grammar explanations —{" "}
            <Link to="/manipuri-translator" className="underline">try the translator</Link>.
          </li>
          <li>
            <strong>Read and write Meitei Mayek</strong> — see the{" "}
            <Link to="/meitei-mayek-ai" className="underline">Meitei Mayek AI</Link> page, or learn the script
            with the <Link to="/meitei-mayek-alphabet" className="underline">alphabet chart</Link>.
          </li>
          <li>
            <strong>Look up words</strong> in the{" "}
            <Link to="/manipuri-dictionary" className="underline">Manipuri dictionary</Link>.
          </li>
          <li>
            <strong>Voice mode</strong> — speak Manipuri and hear the answer read back.
          </li>
          <li>
            <strong>Images, coding, maths and study help</strong>, all explainable in Manipuri.
          </li>
        </ul>

        <h2 className="mt-10 text-2xl font-semibold">How people use it every day</h2>
        <div className="mt-4 space-y-4">
          <ExampleCard
            prompt="Khurumjari, nungairibra?"
            reply="Khurumjari! Ei nungai-i, nahak-ki kari-no? (Hello! I'm well — how about you?)"
          />
          <ExampleCard
            prompt="Translate to Manipuri: I am going to the market tomorrow."
            reply="Ei hayeng keithel-da chatke. — literally 'I tomorrow market-to will-go', because Meiteilon puts the verb last."
          />
          <ExampleCard
            prompt="Write 'Manipur' in Meitei Mayek"
            reply="ꯃꯅꯤꯄꯨꯔ"
          />
        </div>

        <h2 className="mt-10 text-2xl font-semibold">Frequently asked questions</h2>
        <dl className="mt-4 space-y-5">
          {FAQ.map((f) => (
            <div key={f.q}>
              <dt className="font-semibold">{f.q}</dt>
              <dd className="mt-1 text-muted-foreground">{f.a}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 rounded-xl border border-border p-6">
          <h2 className="text-xl font-semibold">Start chatting in Manipuri now</h2>
          <p className="mt-2 text-muted-foreground">
            No app, no install — it runs in your browser and is free to start.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/try" className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">
              Try Manipuri AI free
            </Link>
            <Link to="/plans" className="rounded-lg border border-input px-5 py-3 font-semibold">
              See plans
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
}

function ExampleCard({ prompt, reply }: { prompt: string; reply: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-sm font-medium">You: {prompt}</p>
      <p className="mt-2 text-sm text-muted-foreground">Manipuri AI: {reply}</p>
    </div>
  );
}
