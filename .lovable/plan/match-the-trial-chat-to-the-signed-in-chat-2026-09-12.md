# Match the trial chat to the signed-in chat

## What will change
- Rebuild the trial chat screen around the same header, welcome area, suggestions, message styling, composer controls, language selector, and Instant/Think selector used after sign-in.
- Keep photo upload and the existing three-message trial limit fully working.
- Show sign-up when a guest uses voice conversation or image generation; these actions will not run before authentication.
- Keep chat replies, language selection, image understanding, streaming, and the existing guest API unchanged.
- Correct the Admin panel menu condition so it appears only when the verified admin check returns `isAdmin: true`.

## Technical details
- Extend the shared composer with optional action overrides so the trial can reuse the exact signed-in controls while intercepting only gated tools.
- Preserve the server-enforced guest limit and local remaining-message display.
- Replace the trial spinner with its existing page-shaped skeleton and maintain mobile safe-area behavior.
- Verify the trial on desktop and mobile, test gated tool navigation, and check the latest build result.
