import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
const ReportIssue = lazy(() => import("@/components/ReportIssue").then((m) => ({ default: m.ReportIssue })));
import { supabase } from "@/integrations/supabase/client";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. Try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Manipuri AI — Meiteilon (Manipuri) & English AI Chatbot | Free" },
      { name: "description", content: "Manipuri AI is the first ChatGPT-style AI chatbot that speaks Meiteilon (Manipuri) and English fluently. Supports Latin, Bengali & Meitei Mayek script. Free to try — voice, image generation, memory, live streaming replies." },
      { name: "keywords", content: "Manipuri AI, Meitei AI, Meiteilon AI, Manipur AI chatbot, Manipuri chatbot, Meitei Mayek AI, Meiteilon chatbot, Manipuri language AI, Meitei language chatbot, Manipuri ChatGPT, Manipuri translator, Meitei translator, ꯃꯤꯇꯩ ꯃꯌꯦꯛ AI, Imphal AI, Manipur artificial intelligence, Manipuri voice AI, Manipuri image generator, lairik AI, Loitam Leonath, manipuriai.online" },
      { name: "author", content: "Loitam Leonath" },
      { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
      { name: "google", content: "notranslate" },
      { name: "theme-color", content: "#0d0d0d" },
      { property: "og:site_name", content: "Manipuri AI" },
      { property: "og:title", content: "Manipuri AI — Meiteilon & English AI Chatbot" },
      { property: "og:description", content: "The first AI chatbot fluent in Manipuri (Meiteilon) and English. Free, streaming, voice, image gen, Meitei Mayek support." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://manipuriai.online" },
      { property: "og:image", content: "https://manipuriai.online/og-image.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:locale", content: "en_IN" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Manipuri AI — Meiteilon & English AI Chatbot" },
      { name: "twitter:description", content: "AI that speaks Manipuri (Meiteilon) and English. Free to try." },
      { name: "twitter:image", content: "https://manipuriai.online/og-image.jpg" },
      { name: "application-name", content: "Manipuri AI" },
      { name: "apple-mobile-web-app-title", content: "Manipuri AI" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: "https://manipuriai.online" },
      { rel: "alternate", hrefLang: "en", href: "https://manipuriai.online" },
      { rel: "alternate", hrefLang: "mni", href: "https://manipuriai.online" },
      { rel: "alternate", hrefLang: "x-default", href: "https://manipuriai.online" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/logo.png", type: "image/png", sizes: "512x512" },
      { rel: "apple-touch-icon", href: "/logo.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Figtree:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&display=swap" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://manipuriai.online/#organization",
              name: "Manipuri AI",
              alternateName: ["Meiteilon AI", "Meitei AI"],
              url: "https://manipuriai.online",
              logo: {
                "@type": "ImageObject",
                url: "https://manipuriai.online/logo.png",
                width: 512,
                height: 512,
              },

              founder: { "@type": "Person", name: "Loitam Leonath" },
              sameAs: ["https://t.me/MrLeona", "https://github.com/Leonath56/manipuriai"],
            },
            {
              "@type": "WebSite",
              "@id": "https://manipuriai.online/#website",
              url: "https://manipuriai.online",
              name: "Manipuri AI",
              description: "Bilingual AI chatbot for Manipuri (Meiteilon) and English.",
              publisher: { "@id": "https://manipuriai.online/#organization" },
              inLanguage: ["en", "mni", "mni-Mtei"],
              potentialAction: {
                "@type": "SearchAction",
                target: "https://manipuriai.online/?q={search_term_string}",
                "query-input": "required name=search_term_string",
              },
            },
            {
              "@type": "SoftwareApplication",
              name: "Manipuri AI",
              applicationCategory: "CommunicationApplication",
              operatingSystem: "Web",
              description: "AI chatbot fluent in Manipuri (Meiteilon) and English with voice, image generation and Meitei Mayek script support.",
              offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
              aggregateRating: { "@type": "AggregateRating", ratingValue: "4.9", ratingCount: "128" },
            },
          ],
        }),
      },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const hideReport = pathname.startsWith("/chat") || pathname.startsWith("/try");

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      {!hideReport && <Suspense fallback={null}><ReportIssue /></Suspense>}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
