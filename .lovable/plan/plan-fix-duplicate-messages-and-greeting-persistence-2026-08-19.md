# Plan - Fix Duplicate Messages and Greeting Persistence

## Problem Analysis

### Bug 1: User Message Appears Twice
In a new chat, sending "hi" causes the UI to show "hi" twice.
*   **Root Cause**: In `chat.$chatId.tsx`, the `runSend` function optimistically updates the `messages` query data AND then invalidates it. However, the logic for `turnBaseRef` and `renderedMessages` is misaligned with how `messages.slice` works during the transition between optimistic UI and database refetch. Specifically, when `turnBaseRef.current` is set, the `renderedMessages` calculation `messages.slice(0, Math.min(turnBaseRef.current, messages.length))` may include the newly persisted database message if the refetch completes while `activeForChat` is still truthy, but before the 50-1200ms cleanup timers fire.
*   **Additional Cause**: The `submit` function in `chat.$chatId.tsx` and `try.tsx` already has `preventDefault()`, but the "plus" sign or duplicate UI elements reported by the user suggest potential race conditions or state overlaps.

### Bug 2: AI Repeats Greetings
The AI responds to "hi" with the same greeting repeatedly.
*   **Root Cause**: The `SYSTEM_PROMPT` in `api/chat.ts` and `api/public/guest-chat.ts` has specific instructions for greetings, but the model often gets stuck in a "pattern match" because the conversation history is passed without enough emphasis on moving forward. The instructions say "acknowledge persistence" but don't strictly forbid repeating the *exact* same phrase.

## Proposed Changes

### 1. Frontend Message Deduplication (Authenticated & Guest)
*   Update `src/routes/_authenticated/chat.$chatId.tsx` and `src/routes/try.tsx` to use a robust `Map` by ID for deduplication in the final rendering loop.
*   Ensure that optimistic IDs (starting with `opt-`, `u-`, `a-`) are replaced by database IDs once they arrive.

### 2. Turn Lifecycle Hardening
*   Refine `turnBaseRef` logic to be strictly based on the database message count at the start of a turn.
*   Adjust `renderedMessages` to strictly filter out database messages that have a timestamp *after* the turn started, while the turn is still "in-flight".

### 3. AI System Instructions Refinement
*   Update `SYSTEM_PROMPT` in `src/routes/api/chat.ts` and `src/routes/api/public/guest-chat.ts` to be even more aggressive about avoiding repeated greetings.
*   Instruct the model to check the last assistant message content and explicitly choose a *different* greeting if it was just a greeting.

### 4. Component Cleanup
*   Remove any redundant state updates or listeners that might trigger double submissions.

## Technical Details

### Deduplication Logic
```typescript
const allMessagesMap = new Map();
// 1. Add DB messages
messages.forEach(m => allMessagesMap.set(m.id, m));
// 2. Add optimistic messages only if they aren't "effectively" the same as a DB message
// (e.g., match content and role for the current turn)
```

### Greeting Instruction
"If the last response was a greeting, you MUST NOT repeat the same greeting. Provide a unique follow-up or a completely different native phrase."

## Verification Plan

### Automated Tests
*   I will use a Playwright script to:
    1.  Log in (if needed).
    2.  Open a new chat.
    3.  Type "hi" and click send.
    4.  Verify only ONE "YOU" bubble and ONE "AI" bubble appear.
    5.  Type "hi" again.
    6.  Verify only TWO "YOU" bubbles and TWO "AI" bubbles appear in total.
    7.  Check that the second AI response is different from the first.

### Manual Verification
*   Check mobile view to ensure the "plus" sign and double menu icons are gone (as previously reported).
*   Check that "Thinking..." states don't cause layout shifts or duplicates.
