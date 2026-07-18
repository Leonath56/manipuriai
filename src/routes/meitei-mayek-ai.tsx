import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/meitei-mayek-ai")({
  head: () => ({
    meta: [
      { title: "Meitei Mayek AI — ꯃꯤꯇꯩ ꯃꯌꯦꯛ Chatbot | Manipuri AI" },
      { name: "description", content: "Chat with an AI that reads and writes in Meitei Mayek (ꯃꯤꯇꯩ ꯃꯌꯦꯛ) script. Free Manipuri AI chatbot with native Meiteilon replies, voice mode and image generation." },
      { name: "keywords", content: "Meitei Mayek AI, ꯃꯤꯇꯩ ꯃꯌꯦꯛ AI, Meitei Mayek chatbot, Meitei Mayek keyboard AI, Meitei Mayek translator, Meiteilon script AI, Manipuri script AI" },
      { property: "og:title", content: "Meitei Mayek AI — ꯃꯤꯇꯩ ꯃꯌꯦꯛ Chatbot" },
      { property: "og:description", content: "AI chatbot that natively replies in Meitei Mayek (ꯃꯤꯇꯩ ꯃꯌꯦꯛ) script." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://manipuriai.online/meitei-mayek-ai" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://manipuriai.online/meitei-mayek-ai" }],
  }),
  component: Page,
});

function Page() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Meitei Mayek AI — ꯃꯤꯇꯩ ꯃꯌꯦꯛ Chatbot</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          The first AI chatbot that natively reads and writes in <strong>Meitei Mayek (ꯃꯤꯇꯩ ꯃꯌꯦꯛ)</strong> —
          the traditional script of Manipur. Type in Meitei Mayek, romanized Manipuri, Bengali script or English,
          and Manipuri AI will reply in the same script.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Why Meitei Mayek matters</h2>
        <p className="mt-3 text-muted-foreground">
          Meitei Mayek is the indigenous script of Meiteilon (Manipuri), the official language of Manipur, India.
          Most generic AI tools garble Meitei Mayek characters. Manipuri AI is trained to preserve script,
          tone marks and spellings.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">What you can do</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
          <li>Convert romanized Manipuri to Meitei Mayek and back</li>
          <li>Write essays, letters and poems directly in ꯃꯤꯇꯩ ꯃꯌꯦꯛ</li>
          <li>Ask questions and get answers in native Meitei Mayek script</li>
          <li>Voice mode: speak Manipuri, hear it back (Pro / Max)</li>
        </ul>

        <div className="mt-10 flex gap-3">
          <Link to="/try" className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">Try free</Link>
          <Link to="/auth" className="rounded-lg border border-input px-5 py-3 font-semibold">Sign up</Link>
        </div>
      </article>
    </main>
  );
}
