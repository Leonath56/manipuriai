# Match the trial sidebar controls to the main chat

## What will change
- Add the same sidebar open/close button used by the signed-in chat to the trial page header.
- Let the desktop trial sidebar collapse and reopen with the same width, opacity, and slide transition.
- Add the same mobile drawer, dimmed backdrop, close button, Escape handling, and swipe-left-to-close behavior.
- Keep all existing trial-chat features, limits, sign-in gates, and content unchanged.

## Technical details
- Reuse the main chat's `PanelLeftOpen` and `PanelLeftClose` controls and matching transition classes.
- Keep desktop and mobile sidebar state separate so each viewport behaves like the signed-in chat.
- Verify the result on desktop and phone layouts, then check the current build result.
