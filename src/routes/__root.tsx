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
import { isClientAbort } from "@/lib/client-abort";


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
  const router = useRouter();
  const transient = isClientAbort(error);
  useEffect(() => {
    if (transient) {
      // Connection dropped mid-navigation (reload, tab switch, flaky network).
      // Nothing actually broke — silently retry instead of showing an error.
      router.invalidate();
      reset();
      return;
    }
    console.error(error);
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error, transient, router, reset]);

  if (transient) return null;


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
      // `interactive-widget=resizes-content` makes the on-screen keyboard shrink
      // the viewport instead of scrolling it, which is what keeps the composer
      // pinned above the keyboard on Android Chrome. `viewport-fit=cover` is
      // what makes the env(safe-area-inset-*) padding meaningful on notched iOS.
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" },
      { name: "keywords", content: "Manipuri AI, Meitei AI, Meiteilon AI, Manipur AI chatbot, Manipuri chatbot, Meitei Mayek AI, Meiteilon chatbot, Manipuri language AI, Meitei language chatbot, Manipuri ChatGPT, Manipuri translator, Meitei translator, ꯃꯤꯇꯩ ꯃꯌꯦꯛ AI, Imphal AI, Manipur artificial intelligence, Manipuri voice AI, Manipuri image generator, Loitam Leonath, manipuriai.online" },
      { name: "author", content: "Loitam Leonath" },
      { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
      { name: "google", content: "notranslate" },
      { name: "theme-color", content: "#0d0d0d" },
      { property: "og:site_name", content: "Manipuri AI" },
      { property: "og:type", content: "website" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:locale", content: "en_IN" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "application-name", content: "Manipuri AI" },
      { name: "apple-mobile-web-app-title", content: "Manipuri AI" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico?v=6", sizes: "any" },
      { rel: "icon", href: "/logo.png?v=6", type: "image/png", sizes: "512x512" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=6" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    ],
    scripts: [
      {
        children: `
          function loadDeferredStyles() {
            var addStyle = function(url, integrity) {
              var link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = url;
              if (integrity) {
                link.integrity = integrity;
                link.crossOrigin = 'anonymous';
              }
              document.head.appendChild(link);
            };
            addStyle('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Figtree:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=Noto+Sans+Meetei+Mayek:wght@400;500;600;700&display=swap');
            addStyle('https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css', 'sha384-GvrOXuhMATgEsSwCs4smul74iXGOixntILdUW9XmUC6+HX0sLNAK3q71HotJqlAn');
          }
          if (window.requestIdleCallback) {
            requestIdleCallback(loadDeferredStyles);
          } else {
            window.addEventListener('load', loadDeferredStyles);
          }
        `
      },

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
            {
              "@type": "FAQPage",
              mainEntity: [
                { "@type": "Question", name: "What is Manipuri AI?", acceptedAnswer: { "@type": "Answer", text: "Manipuri AI is the first ChatGPT-style AI chatbot that speaks Meiteilon (Manipuri) and English fluently, with support for Latin, Bengali and Meitei Mayek (ꯃꯤꯇꯩ ꯃꯌꯦꯛ) scripts." } },
                { "@type": "Question", name: "Is Manipuri AI free to use?", acceptedAnswer: { "@type": "Answer", text: "Yes. You can try Manipuri AI free without signing up (3 messages), and signed-in free users get 20 messages every day. Pro (₹99/mo) and Max (₹399/mo) unlock unlimited chat, voice mode and AI image generation." } },
                { "@type": "Question", name: "Does Manipuri AI support Meitei Mayek script?", acceptedAnswer: { "@type": "Answer", text: "Yes. Manipuri AI can read and reply in Meitei Mayek (ꯃꯤꯇꯩ ꯃꯌꯦꯛ), Bengali script, romanized Manipuri, and English — it auto-detects your language and replies in the same script." } },
                { "@type": "Question", name: "Who created Manipuri AI?", acceptedAnswer: { "@type": "Answer", text: "Manipuri AI was created by Loitam Leonath from Manipur, India." } },
                { "@type": "Question", name: "Can Manipuri AI translate between Manipuri and English?", acceptedAnswer: { "@type": "Answer", text: "Yes, it works as a Manipuri–English translator both ways and preserves Meitei Mayek script when requested." } },
              ],
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
    // `dark` is what activates the `.dark` token block and every `dark:` variant
    // in the app (notably `dark:prose-invert`). Manipuri AI is dark-first, so it
    // is set statically here rather than guessed at runtime — no theme flash.
    // `color-scheme` makes native controls, form widgets and the overscroll
    // gutter match instead of rendering light.
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
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
      // INITIAL_SESSION and TOKEN_REFRESHED are routine background events.
      // Invalidating the router for either remounts the active chat and makes
      // the whole page visibly flash after a streamed response.
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        router.invalidate();
        queryClient.invalidateQueries();
      }
      
      if (event === "SIGNED_OUT") {
        router.invalidate();
        queryClient.clear();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      {!hideReport && <Suspense fallback={null}><ReportIssue /></Suspense>}
      {/*
        `theme` was unset, so sonner defaulted to light and richColors rendered
        pale error toasts on a dark app. The offset clears the 56px sticky
        header, which the toast used to sit on top of on mobile.
      */}
      <Toaster richColors theme="dark" position="top-center" offset="68px" closeButton />
    </QueryClientProvider>
  );
}
