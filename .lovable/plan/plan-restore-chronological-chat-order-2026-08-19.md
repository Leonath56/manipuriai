# Plan - Restore Chronological Chat Order

Restore the standard chat layout where user messages appear first, followed by AI responses (including loading states and streaming content).

## Proposed Changes

### Frontend - Chat Route
- **File:** `src/routes/_authenticated/chat.$chatId.tsx`
- **Actions:**
    - Remove the `flex-col-reverse` wrapper from turn grouping to restore normal order.
    - Reorder elements in `showCarryover` block so the user prompt appears before the assistant's loading/streaming state.
    - Adjust margins/spacing to maintain visual clarity.

### Frontend - Guest Chat
- **File:** `src/routes/try.tsx`
- **Actions:**
    - Remove `flex-col-reverse` from turn grouping.
    - Reorder elements in `messages.map` logic to ensure user messages precede assistant responses.

## Technical Details
- Standard flex layout (column) will naturally stack User then AI.
- The `msg-pop` animation will be maintained for the new turn content.
- Image thumbnails in user prompts will remain correctly positioned.
