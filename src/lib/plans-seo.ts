import { PLAN_LIMITS, type Plan } from "./plans";

export const PLANS_URL = "https://manipuriai.online/plans";

export const plansApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${PLANS_URL}#application`,
  name: "Manipuri AI",
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Web",
  url: "https://manipuriai.online",
  image: "https://manipuriai.online/og-image.jpg?v=6",
  description: "Web-based AI chatbot for Manipuri (Meiteilon) and English with Free, Pro and Max digital subscription plans.",
  offers: (["free", "pro", "max"] as const).map((plan: Plan) => ({
    "@type": "Offer",
    name: PLAN_LIMITS[plan].label,
    price: String(PLAN_LIMITS[plan].priceInPaise / 100),
    priceCurrency: "INR",
    url: PLANS_URL,
    description: plan === "free"
      ? "Free access: 8 messages per day. Daily limits reset at midnight IST."
      : `${PLAN_LIMITS[plan].label} digital subscription: ₹${PLAN_LIMITS[plan].priceInPaise / 100} for one month, ${PLAN_LIMITS[plan].dailyMessages} messages per day${plan === "max" ? " and Deep Think mode" : ""}. Daily limits reset at midnight IST.`,
    ...(plan === "free" ? {} : {
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: String(PLAN_LIMITS[plan].priceInPaise / 100),
        priceCurrency: "INR",
        billingDuration: "P1M",
      },
    }),
  })),
};