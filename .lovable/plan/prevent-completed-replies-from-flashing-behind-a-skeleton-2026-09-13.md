# Prevent completed replies from flashing behind a skeleton

## Goal
Keep the finished first reply visible while the app moves from the new-chat screen to its saved conversation, without weakening destination skeletons for ordinary navigation.

## Changes
- Start preloading the destination conversation route as soon as the new chat ID is received during streaming.
- After the answer is saved, warm the destination message cache before navigation while the completed carryover reply remains visible.
- Reuse one message-query definition in both the prefetch and conversation page so the destination renders the real messages immediately.
- Keep the existing route skeleton for opening unrelated, uncached conversations.

## Validation
- Confirm the reported `utils.ts` error is stale and the current typecheck remains clean.
- Test the first-message handoff in the browser and verify no grey conversation skeleton covers the completed answer.
- Check the latest build and runtime diagnostics.
