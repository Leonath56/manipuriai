export type Plan = "free" | "pro" | "max";

export const PLAN_LIMITS: Record<Plan, { dailyMessages: number; label: string; price: string; priceInPaise: number; model: string; features: string[] }> = {
  free: {
    label: "Free",
    price: "₹0",
    priceInPaise: 0,
    dailyMessages: 20,
    model: "google/gemini-2.5-pro",
    features: [
      "20 AI messages per day",
      "Bilingual Manipuri & English",
      "Basic chat history",
      "Markdown & code blocks",
    ],
  },
  pro: {
    label: "Pro",
    price: "₹99",
    priceInPaise: 9900,
    dailyMessages: 500,
    model: "google/gemini-2.5-pro",
    features: [
      "500 messages per day",
      "Faster responses",
      "Voice mode",
      "AI image generation",
      "Priority processing",
    ],
  },
  max: {
    label: "Max",
    price: "₹399",
    priceInPaise: 39900,
    dailyMessages: 10000,
    model: "google/gemini-2.5-pro",
    features: [
      "Effectively unlimited messages",
      "Fastest responses",
      "Premium AI model",
      "Voice mode & AI images",
      "Unlimited chat history",
      "Early access to new features",
    ],
  },
};
