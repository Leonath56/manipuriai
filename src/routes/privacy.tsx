import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Manipuri AI" },
      { name: "description", content: "How Manipuri AI collects, uses, and protects your data. Maintained by the Manipuri AI team." },
      { property: "og:title", content: "Privacy Policy — Manipuri AI" },
      { property: "og:description", content: "How Manipuri AI collects, uses, and protects your data." },
      { property: "og:url", content: "https://manipuriai.online/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://manipuriai.online/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen aurora-bg">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>
        <h1 className="mt-6 text-4xl font-bold tracking-tight" style={{ fontFamily: "var(--font-serif)", color: "var(--gold)" }}>
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: July 18, 2026</p>

        <div className="prose prose-invert mt-8 max-w-none space-y-6 text-sm leading-relaxed text-foreground/90">
          <section>
            <h2 className="text-lg font-semibold text-foreground">1. Who we are</h2>
            <p>
              Manipuri AI ("we", "us") is a bilingual AI chatbot for Meiteilon (Manipuri) and English, operated by
              Loitam Leonath from Manipur, India. Contact: <a className="underline" href="https://t.me/MrLeona">t.me/MrLeona</a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">2. Data we collect</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Account:</strong> email, display name, age (provided at signup), and a Google user ID if you sign in with Google.</li>
              <li><strong>Chats:</strong> the messages you send and the AI's replies, stored so you can revisit conversations.</li>
              <li><strong>Optional inputs:</strong> images and voice recordings you upload for AI features.</li>
              <li><strong>Payments:</strong> Razorpay handles card and UPI details — we only store the payment status and plan.</li>
              <li><strong>Technical:</strong> basic logs (IP, browser) for security and abuse prevention.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">3. How we use it</h2>
            <p>To provide the chat service, remember your preferences, improve the Manipuri language model through opt-in corrections, prevent abuse, and process subscription payments. We do not sell your data.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">4. Third parties</h2>
            <p>We use Supabase (auth + database), Google (OAuth sign-in), Razorpay (payments), and AI providers (Google Gemini, Lovable AI Gateway) to generate replies. Your messages are sent to these AI providers only to generate the response.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">5. Your rights</h2>
            <p>You can delete your account and all associated chats at any time by contacting us. You can also request an export of your data.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">6. Security</h2>
            <p>Data is stored on Supabase with row-level security. Passwords are hashed. Payments are PCI-handled by Razorpay — we never see full card numbers.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">7. Children</h2>
            <p>Manipuri AI is not intended for users under 13. If you believe a child has signed up, contact us to remove the account.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">8. Changes</h2>
            <p>We may update this policy. Material changes will be announced on the homepage.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">9. Contact</h2>
            <p>Questions? Reach out on Telegram: <a className="underline" href="https://t.me/MrLeona">@MrLeona</a>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
