# Plan - Fix "Hi" Greeting History and Multi-Greeting Issues

The user is reporting that repeated "hi" messages are still problematic and that history containing "hi" does not show correctly.

## Proposed Changes

### 1. Fix Greeting Rendering in History
- The issue likely stems from how the `ChatView` component determines which messages to show during a stream vs history.
- Currently, it uses `turnBaseRef` and `messages.length` to hide messages that are being streamed.
- If a "hi" message is in history, it should ALWAYS be shown.
- I will refine the logic in `src/routes/_authenticated/chat.$chatId.tsx` to ensure that messages from the database are never hidden unless they are actually the exact turn currently being handled by `activeStream`.

### 2. Fix Fast Greeting Variety in Main Chat
- Ensure `src/routes/api/chat.ts` properly varies the greeting by using a more dynamic seed (already includes `Date.now()`, but I'll double-check it's not being cached or throttled).
- Verify the "hi" messages are correctly saved to the database in the main chat flow.

### 3. Fix Message Duplication/Visibility Logic
- The user mentions "when i tried to open history which contain hi it does no show". This suggests that some filtering logic is being over-aggressive when loading historical chats that start with or contain greetings.
- I will check the `MessageRow` and rendering loop for any logic that might skip messages.

## Technical Details
- **File**: `src/routes/_authenticated/chat.$chatId.tsx`
  - Update the rendering slice logic. Instead of just `messages.length`, I'll use `activeForChat`'s internal tracking more strictly to only hide the *in-progress* message.
- **File**: `src/routes/api/chat.ts` (and `guest-chat.ts` if relevant)
  - Ensure fast greetings are saved correctly to the `messages` table.

## Verification Plan
- **Manual Test**: Open a chat history that contains "hi" messages.
- **Manual Test**: Send "hi" multiple times in the main chat and verify each appears with its own reply.
- **Console Check**: Verify no errors related to `turnBaseRef` or message IDs.
