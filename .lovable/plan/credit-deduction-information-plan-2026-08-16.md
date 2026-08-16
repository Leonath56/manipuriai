# Credit Deduction Information Plan

The user is asking where AI credits are deducted from when using the application. This plan outlines the technical implementation and user-facing explanation of how credits are tracked and deducted.

## User-facing explanation
Credits are deducted based on the AI model used and the type of interaction (text chat, voice, or image generation). 
- **Text Chat:** Credits are deducted per message. Different plans have different daily limits.
- **Image Generation:** Deducts credits for each image generated.
- **Voice Mode:** Deducts credits for text-to-speech conversion.
- **Deep Thinking:** Uses a more powerful model (Gemini 2.5 Pro) which may consume more credits than the Instant mode.

## Technical details
The credit system operates at two levels:
1. **Application-level limits:** Managed via the `daily_usage` table in the database, enforcing daily message caps per user plan (Free: 20, Pro: 500, Max: 10,000).
2. **Infrastructure-level credits:** Deducted from the **Lovable AI Gateway** (Lovable Cloud) when the application makes calls to external AI providers (Google Gemini, OpenAI).

### Implementation Audit & Fixes
- **Daily Usage Tracking:** The `increment_daily_usage` RPC (called in `src/routes/api/chat.ts`) atomically tracks message counts.
- **Gateway Credits:** The `LOVABLE_API_KEY` facilitates credit deduction from the project's Lovable account balance.
- **Admin Visibility:** The admin dashboard displays "AI Credits Remaining" by calling the `getCreditStatus` function, which fetches the balance from the Lovable credits API.
- **Guest Limits:** Guest sessions are limited to 3 messages, tracked via `guest_sessions` table.

### Planned Changes
1. **Improve Admin Credit Display:** Ensure the `getCreditStatus` function in `src/lib/credits.functions.ts` uses the live `credits--get_credit_balance` tool instead of a hardcoded value if possible, or at least update the cached representation.
2. **Clarify Plan Limits:** Ensure the `PLAN_LIMITS` in `src/lib/plans.ts` correctly reflect the intended credit consumption logic.

## Verification
- Monitor the `daily_usage` table to ensure counts increment correctly.
- Verify the Admin Dashboard shows the correct remaining credit balance from Lovable Cloud.
