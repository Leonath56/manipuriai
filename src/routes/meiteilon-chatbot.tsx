import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/meiteilon-chatbot")({
  head: () => ({
    meta: [
      { title: "Meiteilon Chatbot — ChatGPT for Manipur | Manipuri AI" },
      { name: "description", content: "The first ChatGPT-style Meiteilon chatbot. Ask questions in Manipuri, get streaming replies in your script. Free, with voice and image generation." },
      { name: "keywords", content: "Meiteilon chatbot, Manipuri ChatGPT, Manipur AI chatbot, Manipuri AI assistant, Meitei AI assistant, Imphal AI, lairik AI, best Manipuri AI" },
      { property: "og:title", content: "Meiteilon Chatbot — ChatGPT for Manipur" },
      { property: "og:description", content: "ChatGPT-style AI assistant that speaks Meiteilon (Manipuri) fluently." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://manipuriai.online/meiteilon-chatbot" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://manipuriai.online/meiteilon-chatbot" }],
  }),
  component: Page,
});

function Page() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Meiteilon Chatbot</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          A ChatGPT-style AI assistant built for Manipur — fluent in <strong>Meiteilon (Manipuri)</strong> and
          English, with word-by-word streaming replies, voice mode, image generation and persistent memory.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Made in Manipur</h2>
        <p className="mt-3 text-muted-foreground">
          Manipuri AI is built by <strong>Loitam Leonath</strong> for the Meitei community. It respects
          Meiteilon grammar, honorifics and script — something no general-purpose chatbot does well today.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">Features</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
          <li>Native Meitei Mayek (ꯃꯤꯇꯩ ꯃꯌꯦꯛ) reading &amp; writing</li>
          <li>Streaming replies (word-by-word, like ChatGPT)</li>
          <li>Voice mode: talk to the AI in Manipuri (Pro / Max)</li>
          <li>AI image generation from Manipuri prompts (Pro / Max)</li>
          <li>Persistent memory that remembers your name, age and preferences</li>
        </ul>

        <div className="mt-10 flex gap-3">
          <Link to="/try" className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">Try free</Link>
          <Link to="/auth" className="rounded-lg border border-input px-5 py-3 font-semibold">Sign up</Link>
        </div>
      </article>
    </main>
  );
}
