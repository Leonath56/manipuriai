# Plan: Implement Predefined Fast Greetings

Optimize the response time for common greetings by implementing a "Fast-Path" greeting logic. This bypasses the AI model call for simple phrases like "hi" or "hello" and immediately returns a randomized, personalized Manipuri greeting.

## Proposed Changes

### 1. Update `src/routes/api/chat.ts` (Main Chat)
- Add a new `FAST_GREETINGS` map containing variations of natural Meiteilon greetings.
- Implement a `getFastGreeting` helper function that checks if a user message is a simple greeting.
- Inject the user's `displayName` into the greeting (e.g., "Hi, Leo Nungairibra?").
- If a greeting is detected, immediately return a `ReadableStream` with the predefined response, bypassing the expensive AI model call.

### 2. Update `src/routes/api/public/guest-chat.ts` (Guest Trial Chat)
- Implement identical "Fast-Path" logic for the guest chat trial.
- Use the `name` provided in the guest request body for personalization.
- Ensure the turn is still persisted to the database for tracking limits.

## Technical Details

### Greeting Variations (Examples)
- "Hi, {name} Nungairibra? Kari mateng panggani?"
- "Khurumjari {name}! Nungairibra? Kari wari leige?"
- "Hello {name}! Nungai-nungai leibra? Kari mateng pangjouge?"

### Detection Logic
- Case-insensitive regex match for "hi", "hello", "hey", "khurumjari", "nungairibra".
- Only triggers if the message is short (under 20 characters) and has no attachments.

### User Impact
- **Instant Response:** Greetings will appear within milliseconds instead of seconds.
- **Improved UX:** The app feels more responsive and "alive" with immediate feedback.
- **Cost Saving:** Reduces AI model token usage for trivial interactions.
