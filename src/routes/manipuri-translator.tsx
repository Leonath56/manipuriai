import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/manipuri-translator")({
  head: () => ({
    meta: [
      { title: "Manipuri Translator — English ⇄ Meiteilon AI Translator | Free" },
      { name: "description", content: "Free AI-powered Manipuri (Meiteilon) ⇄ English translator. Supports Meitei Mayek, Bengali script and romanized Manipuri. Faster and more accurate than Google Translate for Manipuri." },
      { name: "keywords", content: "Manipuri translator, Meiteilon translator, English to Manipuri, Manipuri to English, Meitei translator, Manipuri translation AI, Manipuri to Meitei Mayek, translate Manipuri online" },
      { property: "og:title", content: "Manipuri Translator — English ⇄ Meiteilon" },
      { property: "og:description", content: "Free AI translator for Manipuri (Meiteilon), English and Meitei Mayek." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://manipuriai.online/manipuri-translator" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://manipuriai.online/manipuri-translator" }],
  }),
  component: Page,
});

function Page() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Manipuri Translator</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Translate between <strong>English and Manipuri (Meiteilon)</strong> instantly with AI. Manipuri AI
          understands romanized Manipuri, Bengali script and Meitei Mayek (ꯃꯤꯇꯩ ꯃꯌꯦꯛ) — and preserves the
          script you use.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">More accurate than generic translators</h2>
        <p className="mt-3 text-muted-foreground">
          Popular translators struggle with Meiteilon grammar (SOV word order), honorifics and Meitei Mayek script.
          Manipuri AI is tuned specifically for the language and gets these right.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Examples</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
          <li><em>Hello, how are you?</em> → Khurumjari, nahakna kadaino leiribage?</li>
          <li><em>Thank you</em> → Thagatchari 🙏</li>
          <li>Meitei Mayek output on request: ꯈꯨꯔꯨꯝꯖꯔꯤ</li>
        </ul>

        <div className="mt-10 flex gap-3">
          <Link to="/try" className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">Try free</Link>
          <Link to="/auth" className="rounded-lg border border-input px-5 py-3 font-semibold">Sign up</Link>
        </div>
      </article>
    </main>
  );
}
