export type Plan = "free" | "pro" | "max";

export const PLAN_LIMITS: Record<Plan, { dailyMessages: number; label: string; price: string; model: string; features: string[] }> = {
  free: {
    label: "Free",
    price: "$0",
    dailyMessages: 20,
    model: "google/gemini-3-flash-preview",
    features: [
      "20 AI messages per day",
      "Bilingual Manipuri & English",
      "Basic chat history",
      "Markdown & code blocks",
    ],
  },
  pro: {
    label: "Pro",
    price: "$9",
    dailyMessages: 500,
    model: "google/gemini-3-flash-preview",
    features: [
      "500 messages per day",
      "Faster responses",
      "Longer chat history",
      "Priority processing",
      "File upload (coming soon)",
    ],
  },
  max: {
    label: "Max",
    price: "$29",
    dailyMessages: 10000,
    model: "google/gemini-2.5-pro",
    features: [
      "Effectively unlimited messages",
      "Fastest responses",
      "Premium AI model",
      "Unlimited chat history",
      "Early access to new features",
      "Priority support",
    ],
  },
};
