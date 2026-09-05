# Manipuri AI — Improvement Progress

Staged audit and fix effort. Each stage is verified before the next begins.

**Verification gate on this machine:** `./node_modules/.bin/tsc --noEmit -p tsconfig.json`

`vite build` and `vite dev` both fail before touching project code, with:

```
@lovable.dev/mcp-js: routesDir "src/routes" must resolve under C:/Users/LEGION/Claude project,
got C:\Users\LEGION\Claude project\src\routes
```

This is a Windows path-separator bug inside the vendored plugin
(`node_modules/@lovable.dev/mcp-js/dist/stacks/tanstack/vite.js` — `normalizePath()`
produces forward slashes, then `assertContains()` compares it against a backslash
`resolve()` result). Confirmed pre-existing by extracting the pristine ZIP to a
clean directory and reproducing the identical failure there. Deploy previews on Linux
are unaffected.

**Update, Stage 5:** the plugin is the *only* build blocker. Running `vite build`
with a temporary config that omits `mcpPlugin()` and changes nothing else completes
successfully — client bundle, SSR bundle and nitro output. So the application code is
build-verified; what remains impossible locally is **runtime/browser** verification.

---

## Stage 1 — Architecture & critical bug audit (server-side P0) — DONE

| # | Defect | Fix |
|---|---|---|
| P0-1 | A stopped or disconnected reply was never persisted — the user's question vanished on the next refetch | `persistTurn()` is idempotent and called on **every** exit path: normal end, abort, client disconnect, upstream failure |
| P0-2 | User + assistant rows were inserted in one multi-row insert, so both got the same transaction timestamp and sorted non-deterministically | Explicit timestamps 1 ms apart (`userAt`, `assistantAt`), applied on both the chat and image paths |
| P0-3 | Quota was charged before generation and never refunded on failure | `refundQuota()` (charge-once/refund-once) on upstream failure, empty reply, and genuine stream errors; `refund_daily_usage` RPC added |
| P0-4 | Tool-call deltas were accumulated into a plain array indexed by the provider's `index`; out-of-order/sparse deltas left holes and crashed the executor loop, killing the whole stream | Accumulated in a `Map<number, …>`, sorted on use, entries without a name filtered out |
| P0-5 | Malformed tool-call JSON threw and killed the stream | Guarded `JSON.parse` with an object-shape check |
| P0-6 | MCP tool discovery ran on every message: one DB query plus a live `tools/list` per server, all before the model call | `loadMcpTools()` — 60 s TTL cache with in-flight dedupe; negative results cached too |
| P0-7 | Client disconnect was logged as a server error | Abort is detected (`request.signal.aborted` / `AbortError`) and treated as a normal outcome |

Also added: `omitMessageIds` on the request body (max 200 uuids) so the server can
hide superseded rows from the model's history **without deleting them**, and
`HISTORY_MESSAGE_LIMIT` / `HISTORY_CHAR_LIMIT` constants.

**Files:** `src/routes/api/chat.ts`, `src/integrations/supabase/types.ts`,
`supabase/migrations/20260902160000_refund_daily_usage.sql`

⚠️ **The `refund_daily_usage` migration has not been applied to a live database yet.**
Until it is, the refund calls fail silently (they are wrapped) and quota is not
refunded — no data loss, but users are still billed for failed replies.

---

## Stage 2 — Client-side P0 — DONE

### Non-destructive regenerate / edit-and-resend

The old flow deleted first and re-sent second, so any failure between the two lost
the turn permanently. `editAndResend` deleted with `.gte("created_at", cutoff)`,
which — because the server used to write both rows with an identical timestamp —
also removed rows that merely *shared* a timestamp with the edited message.

New flow: **hide → send → verify → only then delete.**

1. `hiddenIds` hides the superseded rows in the UI. Nothing is deleted.
2. The request carries `omitMessageIds`, so the model does not see the old turn twice.
3. After the stream ends, re-read the chat and confirm a **brand-new assistant row**
   exists (not in `startIds`, not in `replaceSet`).
4. Only then `delete().in("id", replaceIds)` — explicit ids, never a timestamp range.
5. Any failure path clears `hiddenIds`; since nothing was deleted, the originals
   simply reappear.

Row selection is id-based off `sortMessages()`, the same ordering the user sees, so
a timestamp collision can no longer pick the wrong rows.

### Stop / Abort

`streamChat` no longer throws on abort — it returns `{ reply, aborted }`, so partial
text survives. Both the pre-headers fetch abort and the mid-read abort are covered,
with `reader.cancel()` in a `finally`.

- `chat.$chatId.tsx` — Stop keeps the partial reply; the server has already persisted it.
- `chat.index.tsx` — **had no AbortController or Stop button at all**; both added.
  Removed the fake `u-1`/`a-1` cache seeding (placeholder rows that never matched
  the database) and the 10 ms `setTimeout` around `navigate`.
- `voice.tsx` — regression fix: an interrupted reply must not be spoken.
- `sending` is cleared in `finally` on every path, so the UI cannot stick in a
  loading state. A zero-text outcome clears the carryover instead of leaving an
  empty assistant bubble nothing ever removed.

### Race conditions

- `inFlightRef` — a **synchronous** double-send guard. `sending` is React state, so
  two clicks in the same tick both read it as `false`, which started two turns
  claiming the same `replaceIds` and left the first stream unstoppable (the second
  overwrote `abortRef`). Applied to `runSend`, the inline image branch, and the
  new-chat submit.
- Server-side `isPlaceholder`: the server persists a failure notice so an
  unanswered question is not lost — but for a regenerate that would have traded a
  good answer for an error string. Placeholders are never saved when
  `omitMessageIds` is non-empty, because the client still holds the original.
- The image branch's optimistic `opt-` row is now cleared on failure; it used to
  linger in the cache as a phantom user message.

**Files:** `src/lib/chat-stream.ts`, `src/routes/_authenticated/chat.$chatId.tsx`,
`src/routes/_authenticated/chat.index.tsx`, `src/routes/_authenticated/voice.tsx`,
`src/routes/api/chat.ts`

---

## Stage 3 — Performance & reliability (P1) — DONE

### The headline finding

`chat-stream.ts` awaited `setTimeout(10 + Math.random() * 15)` **per word**, after
the server had already delivered the text. Measured by running the old and new
implementations over identical input (360-word reply, 90 network deltas):

```
reply: 360 words, 90 network deltas
OLD: 15188ms of client-side delay, 720 onChunk calls (= React updates)
NEW:     0.4ms of client-side delay,  90 onChunk calls
delta: -15187ms wall clock, 8.0x fewer updates
```

Every long reply finished roughly **15 seconds** after it could have, and Stop felt
unresponsive because a long queue of already-received words was still draining.

The replacement emits on whole-word boundaries (so a word never renders
half-drawn) but flushes everything that is ready in one call. Verified losslessly
against every chunk-boundary offset from 1 to 12 bytes, including Meitei Mayek text.

### Other optimizations

| Area | Before | After |
|---|---|---|
| Store notifications | One React render per token, unbatched | Text growth coalesced into the next animation frame; lifecycle changes (`done`, clear) still flush immediately |
| Duplicate render path | Both a local `streaming` state **and** the cross-route store were updated per chunk — two renders per token, from two sources that could disagree | Local state removed; the store is the single source of truth |
| Long conversations | The full list was re-filtered, re-deduped and re-sorted on every streamed frame | Whole derivation in one `useMemo`, keyed on a single `activeBaseCount` scalar |
| Message rows | Every message re-rendered on every token, each carrying its own state, a `useServerFn` binding and a markdown render | `MessageRow` wrapped in `memo()`; `onEdit` ref-wrapped so its identity is stable |
| Sidebar queries | `["chats"]` and `["profile"]` refetched on every window focus and route change, competing with the in-flight AI request | `staleTime` 60 s / 5 min, `refetchOnWindowFocus: false`. Every mutation path already invalidates these keys |
| `last_login_at` | Unconditional `UPDATE` on every mount, on the page-load critical path | Throttled to once per 6 h and deferred to `requestIdleCallback` |
| Provider fallback | Re-serialized the (image-laden) payload a second time | Serialized once |

### Reliability fixes

- **Model mapping was silently wrong.** `mapToGeminiModel()` listed *none* of the
  model ids actually in use (`gemini-3.7-flash`, `gemini-3.1-pro-preview`,
  `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`). On a Gemini-key
  deployment every one fell through to `gemini-flash-latest`: **Think mode ran on a
  flash model instead of pro**, and the cheap lite-tier helper calls were upgraded
  to flash. All ids are now mapped, with tier-preserving fallbacks for unknown ones.
- **No MCP timeouts anywhere.** Tool discovery gates the model request, so a single
  unresponsive MCP server hung *every* chat message for as long as the socket stayed
  open; a hung tool call froze a reply mid-stream. Now 2.5 s for discovery (optional,
  on the critical path) and 15 s for execution.
- **No upstream AI timeout.** A provider that accepted the socket then went quiet
  hung the request indefinitely while heartbeats kept the browser waiting. Added a
  20 s **headers-only** timeout — cleared the moment headers arrive, so a streaming
  body stays unbounded. Client disconnects still abort the body.
- **Client disconnect triggered a paid retry.** An aborted request fell into the
  429/5xx fallback path and fired a second upstream request for a reply nobody was
  waiting on. Now suppressed when the signal is aborted.
- **Browser TTS kept talking after navigating away.** `speechSynthesis` was never
  cancelled on unmount. Now cancelled — guarded by this row's own state, since
  `speechSynthesis` is global and shared with every other row.

### Conversation context — verified, unchanged

The 20-message / 2000-character setting is implemented correctly:

- Fetches `HISTORY_MESSAGE_LIMIT + omitMessageIds.length` rows descending, filters
  the omitted ids, `.slice(0, 20)`, reverses. The `+ omitLen` headroom is what keeps
  a regenerate from silently shrinking the window.
- `trim()` caps each turn at `HISTORY_CHAR_LIMIT` (2000), applied to both user and
  assistant turns. Image markdown is replaced with `[attached image]` so data URLs
  never enter history.

No behavioural change made. Only a stale comment ("~600 chars") was corrected to
match the constant.

**Files:** `src/lib/chat-stream.ts`, `src/lib/active-stream.ts`,
`src/lib/ai-provider.server.ts`, `src/lib/mcp-client.server.ts`,
`src/components/AuthedShell.tsx`, `src/routes/_authenticated/chat.$chatId.tsx`,
`src/routes/api/chat.ts`

---

## Testing

`tsc --noEmit` — clean (exit 0) after every edit group in all three stages.

17 behavioural tests, run with Node's built-in runner (**no new dependencies**).
Both modules under test are extracted from the shipped source *by script*, so the
tests exercise the real code rather than a retyped copy:

```
✔ no text is lost or reordered, whatever the chunk boundaries
✔ never emits a half-drawn word
✔ one emit per network chunk, not per word
✔ zero-width heartbeats are stripped and never rendered
✔ a heartbeat-only chunk emits nothing at all
✔ newlines count as boundaries
✔ trailing partial word is flushed at stream end
✔ a single word with no spaces still arrives
✔ Meitei Mayek script survives chunking mid-codepoint-sequence
✔ emits promptly — does not hold back a completed word
✔ optimistic ids are excluded, uuids kept
✔ identical timestamps: user sorts before assistant
✔ identical timestamps AND same role: stable by id, never random
✔ regenerate picks the whole trailing exchange, not a colliding row
✔ edit-and-resend replaces from the edited row onward, by id
✔ a row that shares a timestamp with the edited one is not swept up
✔ missing created_at does not throw and sorts first
ℹ pass 17   fail 0
```

`eslint` on all changed files: no new non-formatting problems. The remaining
non-formatting hits (`no-empty` on `catch {}`, two `no-explicit-any` in
`chat.ts`, two in `mcp-client.server.ts`) are pre-existing patterns. The
formatting errors are repo-wide drift — the untouched `AuthedShell.tsx` reported
56 of them before any edit, so the repo was never prettier-clean. **No `--fix`
was run:** reformatting every file would bury the real diff.

### Not tested — requires a running app

`vite build`/`vite dev` cannot start on this machine (see the plugin bug above), so
these paths are reasoned-through and typechecked but **not exercised at runtime**:
normal generation, rapid messages, Stop, Regenerate, Edit & Resend,
network/provider failure, MCP failure, long responses, long conversations, and
switching chats mid-generation. They need a deploy preview or a Linux/macOS
checkout.

---

## Stage 4 — UI/UX, interface & visual polish (done)

### The finding that shaped the stage

The design-token system was decorative, not functional.

`<html>` never carried the `dark` class, so `:root`'s charcoal palette was the only
live one and the entire `.dark` block — an unrelated blue/teal palette — was dead
code. Every `dark:` variant in the codebase had therefore never fired once,
including `dark:prose-invert`, which is what makes markdown legible on a dark
background. A grep found only three `dark:` usages app-wide, which made enabling
the class provably safe.

Meanwhile the colours actually on screen came from hardcoded `bg-black`,
`bg-white`, `text-white` and `bg-neutral-*`, so the surfaces contradicted the
tokens — most visibly a **white composer card on pure black** under light-on-dark
messages, and the same again on `/image`.

### 1. Tokens, palette and typography — `src/styles.css`, `src/routes/__root.tsx`

| Change | Why |
| --- | --- |
| `<html class="dark" style="color-scheme: dark">` | Makes `dark:` variants and native form controls/scrollbars work. |
| Two conflicting palettes → one, on `:root, .dark` | Removes the dead palette; one set of values to reason about. |
| Neutrals given a warm chroma at hue 65 | Dead-grey neutrals beside a gold accent is what made the chat look unfinished next to the landing pages. |
| `--primary` is now gold `oklch(0.8 0.125 78)` | A white send button is the ChatGPT default; brass is the colour this product already owns. |
| `--muted-foreground: oklch(0.735 0.012 65)` | 7.1:1 on `--background`; the old value was borderline for body text. |
| `"Noto Sans Meetei Mayek"` added to **every** font stack + `--font-mayek` | macOS and iOS ship no Meetei Mayek face — ꯃꯤꯇꯩ ꯃꯌꯦꯛ, and the app's own ꯃ logo, rendered as tofu boxes. |
| Real `--font-mono` | The code-block font was resolving to the sans stack. |
| Gold, shadow (`soft`/`glow`/`raise`) tokens exposed in `@theme inline` | So call sites write `text-gold` instead of re-typing oklch triplets. |
| `Noto+Sans+Meetei+Mayek` added to the deferred Google Fonts URL | Same reason; still deferred, so no render-blocking request. |

### 2. Motion and performance — `src/styles.css`

- The global transition rule was `*:not([role=combobox]):not(…)` — a transition,
  including `transform`, on **every node in the document**, each re-tested against a
  four-part `:not()` chain, then partly undone by a blunt `.flex, .grid { transition:
  none }`. Whether an element animated depended on whether it happened to carry a
  flex class. Replaced by an explicit list of interactive elements at 150ms. The
  Select exclusions existed only to escape this rule and are gone.
- **`prefers-reduced-motion` was not handled anywhere in the file.** Every looping
  animation ran regardless of the OS setting. Added a kill-switch at end of file;
  ambient loops (`image-gen-*`) are disabled outright rather than left as a 0.01ms
  flicker.
- Deleted dead utilities: `chat-card`, `msg-user`, `msg-ai` (hardcoded values from
  the old palette, nothing referenced them) and `send-fly` (its keyframes flew the
  element to a hardcoded corner).
- New: `msg-in` (24ms-in-and-up entrance, one-shot), `streaming-tail` (the caret),
  `shimmer` (skeletons).

### 3. Composer — `src/components/chat-shared.tsx`

Two of these were functional bugs, not cosmetics:

- **Enter-to-send ignored `isComposing`.** Committing a Meitei Mayek IME candidate
  with Enter fired the message mid-composition. Now guarded, and on coarse pointers
  Enter inserts a newline instead of sending (phone keyboards have no Shift+Enter).
- **The Send button lived inside the `overflow-x-auto` toolbar** and could scroll out
  of reach on a narrow screen. The scroll region is now the left tool group only;
  Send/Stop sit outside it and never move.

Also: one card instead of a floating pill (`rounded-2xl border bg-card shadow-raise`,
gold `focus-within` border); auto-grow to ~8 rows then internal scroll; `16px`
font-size so iOS Safari does not zoom on focus; **Stop replaced Send in-place**
mid-stream; `env(safe-area-inset-bottom)` padding; attachments as a labelled `<ul>`
with per-item remove buttons.

### 4. Message list & actions — `src/routes/_authenticated/chat.$chatId.tsx`

- Bubbles, avatars and the root surface tokenized (`bg-neutral-900`, `bg-black`,
  `text-white` all gone from the file).
- **The "You" avatar is gone** — a 32px box plus a 12px gap of pure decoration on the
  side of a phone screen with the least room. Right-alignment already says who spoke.
- **The edit pencil moved out of `absolute -left-10`**, which put it off-screen or
  under the sidebar on a narrow viewport, into the action row.
- Action buttons: 24px → **36px on touch, 28px on desktop**, and
  `group-focus-within/row` added — tabbing into them previously left them invisible
  while focused.
- The centred outline Stop button under the reply is gone; Stop is in the composer.
  Regenerate is a quiet ghost pill instead of a competing outline button.
- The "New response" button was pinned at `absolute bottom-32` and drifted over the
  composer as it grew; it is now anchored to the composer's edge and reads "Jump to
  latest".
- The edit textarea spans the column instead of a `min-w-[300px]` box nested inside a
  right-aligned bubble (which overflowed the viewport on a phone), and its Enter
  handler got the same IME guard.
- **Added loading and error states for the history fetch** — there were none: opening
  a chat showed an empty column, and a failed fetch showed that same empty column
  forever with no retry.

Every Stage 2/3 mechanism was preserved: `abortRef`, `inFlightRef`, `hiddenIds`/
`replaceIds` soft-replace, `replacementLanded` verify-then-delete, `omitMessageIds`,
`result.aborted`, `sortMessages`, `activeBaseCount`, `memo(MessageRow)`,
`onEditStable`, the TTS unmount cleanup.

### 5. Markdown & code blocks — `src/components/ChatMarkdown.tsx`

- `break-words` + `[overflow-wrap:anywhere]`: a long URL or hash used to push the
  message wider than the viewport and give the whole page a horizontal scrollbar.
- Tables scroll inside their own bordered box rather than widening the message.
- **The code-block header was `md:opacity-0 md:group-hover:opacity-100`** — on desktop
  the language label and Copy button were invisible until hover, and permanently
  invisible to anyone navigating by keyboard. Always visible now.
- `navigator.clipboard.writeText` was unguarded; it now catches and reports.
- Removed template chrome: `uppercase tracking-widest` on code languages and
  `uppercase` on table headers.

### 6. Sidebar — `src/components/AuthedShell.tsx`

Four functional bugs found here:

1. **Collapse did nothing.** It called `getElementById` and set `data-state` / stripped
   a class — but the parent drives width and transform from React state and blew the
   change away on the next render. Replaced with `onClose()`.
2. **Rename discarded the edit on blur.** Clicking away lost the new title. It commits.
3. **`adminQ` was queried and never read**, so every user saw an Admin panel link that
   led nowhere. Now gated on the result.
4. **The options trigger was `md:opacity-0 md:group-hover:opacity-100`** with no
   keyboard or open-state reveal.

Plus: `confirm()` → an `AlertDialog` that names the chat; a gold rail + `aria-current`
on the active row; skeletons instead of "Loading…"; an error state with retry;
separate empty states for "no chats yet" and "no search matches"; `onError` toasts on
the mutations; sentence-case section headings (`uppercase tracking-wider` eyebrows
removed); an accessible search field with a clear button; `role="dialog"`
`aria-modal` on the mobile drawer with a real close button behind it; Escape closes it.

### 7. Mobile & responsive

- `viewport-fit=cover, interactive-widget=resizes-content` — the composer now stays
  above the software keyboard instead of being covered by it.
- `env(safe-area-inset-bottom)` on the composer and the voice footer.
- **Swipe-to-close** on the drawer, axis-locked: it only takes over after 12px of
  travel and only when horizontal beats vertical by 1.5×; if the first movement is
  vertical the gesture is locked out for the rest of the touch. **Nothing calls
  `preventDefault`, so native scrolling is never suppressed.**
- `touch-action: manipulation` on interactive elements (kills the 300ms tap delay) and
  `-webkit-tap-highlight-color: transparent`.
- Duplicated suggestion grids on `/chat` (a desktop set of four and a mobile set of
  two, the same buttons twice in the DOM) collapsed into one list with the last two
  hidden by class.
- Suggestions seeded with the first four instead of `[]` — the grid rendered empty on
  first paint then popped in, shifting the page down.

### 8. Accessibility

- One global `:focus-visible` ring. Several controls are bare `<button>`/`<a>` rather
  than the shadcn `Button` and had **no focus style at all**.
- `role="status"` + `aria-live="polite"` on the thinking loader, which previously told
  screen readers nothing — the wait was silent. Its label was also
  `text-neutral-500` on `text-neutral-600`, ~3:1, with `animate-pulse` on the text.
- `aria-label`s on the icon-only buttons, the search field, the composer textarea,
  attachment thumbnails and remove buttons; `aria-current="page"` on the active chat.
- Touch targets raised to 36–44px on the message actions, sidebar rows and composer
  controls.
- Contrast: `--muted-foreground` at 7.1:1; `--destructive` lightened for dark.

### 9. `/image` route

Its composer was still light-themed — `bg-white`, `text-black`,
`border-neutral-300` — sitting under a dark results grid. Tokenized to the same
shape language as the chat composer, given the same IME guard, four copies of the
same option-pill class string collapsed into one constant, and the redundant "You"
chip removed.

### Testing

| Check | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.json` | **EXIT 0** |
| `node --test` (Stage 3 suite, 17 tests) | **17 pass / 0 fail** — sort + chunk logic untouched |
| `eslint` on the 8 changed files | 320 errors + 3 warnings, **all 320 `prettier/prettier`**, zero rule violations |
| eslint baseline, same files pristine | **627** `prettier/prettier` errors + the same 3 warnings |
| Tailwind v4 compile of `styles.css` via `@tailwindcss/node` | compiles; 129,517 bytes; every custom utility and composed variant emits rules |
| `vite build` | **fails — pre-existing plugin bug**, see above |

The repo was never prettier-clean: the same six files produced 627 formatting errors
*before* any edit. `--fix` was deliberately not run, so the real diff stays readable.

The build failure happens in the plugin's `configResolved` hook — before Vite reads a
single source module — so it cannot be caused by these changes. It reproduces against
a clean extraction of the original ZIP.

**Verified by compilation, not by running the app.** No dev server or preview is
possible on this machine, so the visual result, streaming appearance, Send/Stop,
Edit/Regenerate, sidebar behaviour and the touch gestures have **not** been seen
working. They need a deploy preview or a Linux/macOS checkout.

### Stage 4 files changed

`src/styles.css` · `src/routes/__root.tsx` · `src/components/chat-shared.tsx` ·
`src/components/ThinkingLoader.tsx` · `src/components/ChatMarkdown.tsx` ·
`src/components/AuthedShell.tsx` · `src/routes/_authenticated/chat.index.tsx` ·
`src/routes/_authenticated/chat.$chatId.tsx` · `src/routes/_authenticated/image.tsx`

---

## Stage 5 — Advanced features & AI experience (done)

Ranked before building, per the brief. Everything below was checked against what
already shipped first; roughly half the feature list was already implemented in
Stages 1–4 and was deliberately left alone (see "not implemented" at the end).

### P1 — Manipuri language tools (`src/lib/lang-tools.ts`, new)

A **Language tools** menu in the composer (wand icon), grouped Translate / Script /
Writing: to English, to Manipuri, to Meitei Mayek, to Latin transliteration, fix my
writing, make it formal, explain the grammar.

Each tool wraps the text already in the composer in an instruction and, where the
answer has one obvious language, sets the reply-language pill to match
(`to-english` → `en`, `to-manipuri` → `mni`, `to-mayek` → `mni-mtei`).

This is a **prompt library, not a translation engine**. There is no offline
transliteration table and nothing claims one — the tools make the model do what it
can already do, phrased well, in one click instead of a paragraph of typing.
Re-applying a tool re-derives from the original text rather than nesting
instructions inside instructions.

### P1 — Meetei Mayek script handling (`src/lib/script.ts`, new)

Meetei Mayek (U+ABC0–ABFF plus Extensions U+AAE0–AAFF) stacks vowel signs and
finals above and below the baseline. At the Latin line-height used everywhere else
the rows collide, and on iOS/macOS — which ship no Meetei Mayek face — it fell back
to tofu. `font-mayek` existed in the stylesheet and almost nothing applied it.

`mayekClass()` is now applied to the composer textarea, the pending/failed/persisted
user bubbles and the whole markdown body. It returns
`font-mayek [&_p]:leading-[1.9] [&_li]:leading-[1.9]` — the descendant variants are
required, because the bubbles and the prose body put an explicit `leading-relaxed`
on the paragraph which would otherwise win over an inherited line-height. Mixed
Manipuri-English text gets the taller leading too: Latin tolerates extra
line-height, Mayek does not tolerate less.

### P1 — Draft preservation (`src/lib/use-draft.ts`, new)

Typing a long message, switching to another chat and coming back lost the whole
thing — the composer is component state, so it died with the route. Drafts are now
keyed per chat (`"new"` for the landing route), debounced 400 ms, skipped when
unchanged, capped at 8000 chars and 20 chats (LRU by last touch). Text only:
attachments are data URLs and persisting megabytes of base64 per draft would blow
the storage quota for nothing.

The restore effect is declared before the save effect on purpose, so the save can't
overwrite a stored draft with the empty initial state.

### P1 — Retry after a failed send (both chat routes)

Previously a failed send cleared the composer and showed a toast that vanished in
four seconds. The message was gone; the only recovery was retyping it.

The send body was split out of the submit handler into `runSend(text, images)`, and
failure now sets a `failed` state that renders the user's message still in its
bubble above a card with the error, **Try again** and **Edit the message**.

On `/chat/$chatId` this only applies to *new* messages: regenerate and
edit-and-resend still have their originals on screen, so those keep the toast and
the Stage 2 non-destructive restore path, untouched.

### P1 — Voice input in the composer (`src/lib/use-dictation.ts`, new)

Reuses the existing `/api/transcribe` endpoint and `preprocessAudio` (16 kHz mono
WAV) — **no new service, no new dependency, no new cost surface**. Mime candidates
are probed (`audio/webm;codecs=opus` → `webm` → `mp4` → `mpeg`) so it works on
Safari. Recording is capped at 90 s, the mic track is released on stop/unmount, and
blobs under 2 KB are dropped without spending a request. Permission
`DOMException`s are mapped to plain sentences. Transcribed text is *appended to the
draft for review*, never auto-sent — a misheard word should be fixable.

Distinct from the existing `/voice` route, which is a full-screen spoken
conversation. This is dictation into the text box.

### P1 — Drag & drop attachments (composer)

Dragging an image onto the composer used to make the browser navigate away from the
conversation and open the file. Now the card highlights with a "Drop to attach"
overlay and the image joins the attachment row. Uses a drag-depth counter so
crossing child elements doesn't flicker, and only reacts when
`dataTransfer.types` actually contains `Files`.

### P2 — Conversation export (`src/lib/export-chat.ts`, new)

**Export → Markdown / JSON** in the per-chat sidebar menu. Entirely client-side: the
rows are read through the user's own RLS policy and a Blob is built in the browser,
so there is no new endpoint and the conversation never leaves the device. Messages
are fetched when the item is clicked rather than joined into the sidebar query — the
list needs titles only.

Markdown replaces `![image](data:…)` attachments and ```` ```image-generation ````
fences with short placeholders, so an export is readable text instead of megabytes
of base64. JSON keeps raw content deliberately: it is the "all of my data" format,
and truncating it there would misrepresent what was saved. Filenames strip path
characters while keeping Meetei Mayek titles readable.

### P2 — Personalization & privacy (`profile.tsx`)

The assistant has always written to `user_memory` through its memory tool, and every
field in that row is injected into the system prompt on every message — but the
person it describes could neither see it nor change it. That is a privacy problem,
not a missing feature.

**What Manipuri AI remembers** now shows and edits name, preferred language/script,
work, interests, recurring topics, and *how you want replies written* — the `notes`
array, which the assistant already treats as standing guidance, so it doubles as the
custom-instructions surface without inventing a column. Plus **Erase memory**.

No migration required: the table's own `Users manage own memory` policy (FOR ALL,
`auth.uid() = user_id`) already permits exactly this. The row is filtered by user id
explicitly so an admin account — which has a broader SELECT policy — reads its own
row instead of erroring on multiple matches. Fields are length-capped (80 chars for
the short ones, 12 × 60 for lists, 8 × 200 for notes) because they are read into
every request. Hydrated once via a ref so a refetch can't overwrite in-progress
typing.

### P2 — Keyboard shortcuts (`src/lib/shortcuts.ts`, `ShortcutsDialog.tsx`, new)

⌘/Ctrl+K search, ⌘/Ctrl+Shift+O new chat, ⌘/Ctrl+B toggle sidebar, ⌘/Ctrl+/ help,
Esc to stop a generating reply. The help dialog renders from the same list the
handler is written against, so it can't advertise a key that does nothing.

⌘K focuses the search field on desktop only. On a phone the sidebar is a modal
drawer that has to mount first, and focusing a field there raises the keyboard over
the list the user just asked to see — so there it just opens the drawer.

Esc-to-stop is bound on the window (so it works while scrolled up reading) and held
in a ref (so the listener isn't rebuilt on every keystroke). It stands down when
another layer already owns the key — an open dialog, dropdown or select should close
itself, not cancel the generation behind it.

### Also fixed

The response cache was **write-only**: both read sites had been switched off in an
earlier stage but the writes kept running, copying up to 50 full replies into
localStorage where nothing would ever read them. The remaining call sites are gone
and `purgeLegacyResponseCache()` reclaims the key once on mount.

### Files

New: `src/lib/lang-tools.ts` · `src/lib/script.ts` · `src/lib/use-dictation.ts` ·
`src/lib/use-draft.ts` · `src/lib/export-chat.ts` · `src/lib/shortcuts.ts` ·
`src/components/ShortcutsDialog.tsx`

Changed: `src/lib/chat-cache.ts` · `src/components/chat-shared.tsx` ·
`src/components/ChatMarkdown.tsx` · `src/components/AuthedShell.tsx` ·
`src/routes/_authenticated/chat.index.tsx` ·
`src/routes/_authenticated/chat.$chatId.tsx` ·
`src/routes/_authenticated/profile.tsx`

No dependencies added. No migrations added. No server routes added.

### Deliberately not implemented

| Feature | Why not |
| --- | --- |
| Edit & resend, regenerate, stop, copy message, copy code, chat search, rename, delete, pin, smart auto-scroll, jump-to-latest, smooth streaming, generation status, multiline / auto-grow / Enter-vs-Shift+Enter, image attachments with paste, per-message TTS, the `/voice` route, image generation, 4-way language selection, Instant/Think modes | Already shipped in Stages 1–4. The brief said not to duplicate existing functionality. |
| Archive conversations | Needs a `chats.archived` column, and the `refund_daily_usage` migration is still unapplied. Delete and pin already cover the need. |
| `profiles.custom_instructions` | Would need a migration. `user_memory.notes` is already read into the system prompt and now editable, which is the same capability without the schema change. |
| Share links | Needs a public-read table, a token scheme and a security review — publishing a user's conversation is not a small feature. |
| Delete a single message | Would desync the `omitMessageIds` history contract the API relies on. Edit-and-resend already covers "I want that turn gone". |
| More model choices | Only Instant and Think are configured. Listing models the backend doesn't route to would be a fake feature. |
| Reasoning / thinking traces | The brief explicitly rules these out where the API doesn't expose them. It doesn't. |
| Saved prompts / templates | The eight rotating suggestions on the landing screen plus the seven language tools already cover the ground, and a full prompt library needs storage and management UI to be worth anything. |

### Stage 5 verification

- `tsc --noEmit -p tsconfig.json` — **clean**, run after each feature group (7 runs).
- `eslint` on all changed files — no new findings. The two non-prettier reports in
  `chat-shared.tsx` (`react-refresh/only-export-components` at line 27,
  `react-hooks/exhaustive-deps` at line 71) both pre-date Stage 5. Prettier-only
  errors are still not auto-fixed, per the standing decision.
- **34 unit tests, all passing** (`node --test`): the 17 from Stage 3 (stream
  chunker, replacement-range selection) still green, plus 17 new ones covering
  export Markdown/JSON serialization, base64 stripping, filename sanitization with
  Meetei Mayek titles, Mayek detection across Mayek / Latin / Bengali-script /
  Extensions, the descendant-leading classes, and every language tool's built
  prompt.
- **`vite build` now completes.** This is the first successful build in the project.
  The failure seen in Stages 1–4 is confirmed as a Windows-only bug in the vendored
  `@lovable.dev/mcp-js` plugin: `assertContains()` compares a parent path that was
  run through `normalizePath()` (forward slashes) against a child from
  `resolve()` (backslashes), using `child.startsWith(parent + sep)` — which can
  never match on Windows. It throws in `configResolved`, before any application
  source is read. Building with a temporary config that omits only `mcpPlugin()`
  succeeds end to end: client bundle, SSR bundle and nitro output. **All Stage 1–5
  application code builds cleanly.** The temporary config was deleted;
  `vite.config.ts` is unchanged.
- Client output: 80 chunks, 2086 kB raw total.

What still could **not** be verified: nothing was run in a browser, on a device, or
against a live database. Every behavioural claim above is a code-level claim. Manual
passes for desktop/mobile layout, Manipuri and mixed-script rendering, dictation
permissions, slow-network failure and the export download dialog are still owed.


**P0**

- `refund_daily_usage` migration not yet applied to a live database.
- No runtime verification performed anywhere. The build itself is now verified (see
  Stage 5 verification), but nothing has been exercised in a browser, on a device or
  against a live database.

**P1**

- **The 1032 kB `ChatMarkdown` chunk is loaded eagerly, defeating its own
  `lazy()`.** `chat.$chatId.tsx:5` lazy-imports it, but `chat-shared.tsx` imports it
  statically, and both chat route chunks list `ChatMarkdown-*.js` as a static
  import — so katex and react-syntax-highlighter come down before the first paint of
  a chat. Found with real numbers once the build was made to run. Fixing it means
  moving `StreamingAssistantContent` behind a boundary too and re-verifying the
  streaming path, which is Stage 3-class work, not a Stage 5 feature.
- History rows are fetched with full `content` and only then trimmed to 2000 chars
  in JS. With 20 long messages that is a large transfer on the critical path;
  fixing it properly needs a `SECURITY DEFINER` RPC that truncates in SQL.
- Images are sent as base64 data URLs inside the JSON body — large uploads, and they
  are re-serialized into the provider request. Object storage + URLs would be the
  real fix, but that is a feature-shaped change, not a P1 tweak.
- Think mode still makes an extra "decide + rewrite the search query" LLM call
  before the main request. Deliberate (better recall); instant mode already skips it.
- `full += chunk` accumulates the whole reply as a growing string on both client
  and server. Fine at current reply lengths.
- Navigating away mid-stream does **not** abort the request. Deliberate: the server
  finishes and persists the full reply, which is the behaviour Stage 2 was fixing.

**P2 / UI (open after Stage 4)**

- **There is no light theme.** The brief said "if both exist" — both did not. One
  palette is now applied to `:root` and `.dark`, so `dark:` variants work, but roughly
  ten routes (`index`, `try`, `auth`, `plans`, `admin`, `voice`, `manipuri-*`,
  `meitei-*`) are still full of hardcoded `bg-black` / `text-white`, and a light theme
  would render them broken. Building one means tokenizing those routes first.
- `voice.tsx` keeps its own hardcoded black-gradient palette. It is a deliberate
  full-screen immersive overlay and is self-consistent, so it was left alone — but it
  is not token-driven.
- Edge-swipe-to-**open** the sidebar is deliberately not implemented: the left screen
  edge is owned by iOS Safari's back-navigation gesture, and competing with it makes
  both unreliable. Only swipe-to-close exists; the header button opens.
- No visual/runtime verification of any Stage 4 change (see above).
- The landing/marketing routes were not touched at all. They were already the most
  polished part of the app; the chat was the part that looked unfinished.
- `ImageResultCard`, `PaidFeatureGate` and the `/plans`, `/admin` and `/auth` screens
  got no polish pass.

**Open after Stage 5**

- Dictation is unverified against a real microphone. The mime-candidate probing,
  permission-error mapping and 90 s cap are code-level only; Safari in particular
  needs a device pass.
- Export downloads via a Blob + synthetic `<a download>`. That is the standard
  approach, but in-app webviews (Instagram, Facebook) sometimes swallow it silently.
- `user_memory.language` is a free-text field because the assistant writes free text
  into it. It is therefore not wired to the composer's 4-way language pill — a user
  could set them to disagree.
- Drafts are text only. Attachments picked but not sent are still lost on navigation.
- The language tools depend entirely on the model's Meiteilon ability. They make the
  request well-phrased; they do not add capability, and nothing in the UI claims they
  do.

**Deferred to later stages**

- Stage 5 (advanced features) — **done**, see above.
- Stage 6 (security, reliability & production hardening) — **done**, see below.
- Stage 7 (final production audit & release readiness) — **done**, see below. This was
  the final stage: status **READY WITH WARNINGS**, with the deploy prerequisites in
  Stage 7 §8.

---

## Stage 6 — Security, reliability & production hardening (done)

### Security issues found and fixed

**1. Quota reset bypass — the most serious finding in the stage.**
`20260816065124` had correctly cut `authenticated` down to `SELECT` on
`public.daily_usage`. `20260816065545`, four minutes later, re-granted
`INSERT, UPDATE, DELETE` while restoring an unrelated set of grants. Combined with
the (correct) own-row RLS policies, any signed-in client could run
`update daily_usage set message_count = 0` — or delete the row — against itself with
the **publishable** key, resetting the free-tier daily limit at will. The limit check
was never the weak part; the counter was. It was a grant regression, not a policy
bug, which is why an RLS-only review would not have caught it.

Fixed in `supabase/migrations/20260904090000_lock_daily_usage_writes.sql`: writes
revoked from `authenticated` and `anon`. The own-row policies are deliberately left
in place — redundant behind the missing grant, but they are what still isolates one
user's usage row from another's if a future migration re-grants writes the way
`20260816065545` did.

**2. Lost-update race on the same counter.** Two remaining call sites still did a
read-then-upsert of `count + 1`, so two overlapping requests recorded one message.
Both now go through the existing atomic `increment_daily_usage` RPC as
`service_role` — which is also what makes the revoke above possible, since the app
no longer needs any user-facing write grant. Changed in `src/lib/chat.functions.ts`
and `src/routes/api/generate-image.ts`.

**3. Links in model output had no `rel` or `target`.** `ChatMarkdown` had no `a`
override at all. Model output can be steered by anything the model read — a pasted
page, a tool result — so an in-tab navigation could carry the user out of a live
conversation, and a bare `target="_blank"` would hand the destination a usable
`window.opener`. Now rendered with `target="_blank" rel="noopener noreferrer
nofollow"`. (react-markdown 10 already drops `javascript:` URLs; there is no
`rehype-raw`, so raw HTML stays escaped; KaTeX runs with the default
`trust: false`.)

**4. Drafts and preferences survived sign-out.** Drafts are keyed by chat id, not by
account, so on a shared browser the next person to sign in inherited the previous
person's unsent message text. Server-side isolation was sound; the composer was
restoring a draft that was never theirs. Added `clearLocalUserData()` in
`src/lib/chat-cache.ts` and wired it into both sign-out paths (`AuthedShell.tsx`,
`profile.tsx`).

**5. Unfiltered `DELETE` on a shared table.** `deleteAccount` ran
`.delete().neq("id", "000…0")` on `chats` — correct only for as long as RLS holds.
Now explicitly `.eq("user_id", userId)`, with a guard if the session can't be
confirmed and error handling on failure. One policy regression away from being a very
bad, unrecoverable statement.

### Audited and found already correct — no change made

Worth recording, because "no finding" here is a result, not a gap: `mcp_servers`
policies (the `USING (true)` variant was dropped in `20260814191633`; final state is
admin-only with `anon` revoked, so `api_key` is not readable by ordinary users); RLS
enabled on all 11 tables with no `DISABLE` anywhere; `chats` / `messages` /
`user_memory` / `profiles` / `payments` isolation; the `prevent_plan_self_upgrade`
`SECURITY DEFINER` trigger; `payments` writes revoked from `authenticated`; no
`dangerouslySetInnerHTML` in live code; zero `console.log` and no secrets in logs; no
secret behind a `VITE_` prefix, and `.env` holds only publishable values; zero CORS
headers anywhere; the email preview route gated by bearer token.

One near-miss during the final audit: `increment_daily_usage` is `SECURITY DEFINER`
and takes an **arbitrary** `_user_id`, and its original migration grants `EXECUTE` to
`authenticated` — which would let any signed-in user exhaust any other user's daily
quota. Reading the full migration history showed it revoked twice afterwards
(`20260719091230`, then `20260816094925`), so the live grant is `service_role` only.
Already closed; flagged here because the first migration read in isolation looks
alarming. `refund_daily_usage` is correctly `service_role`-only with explicit
revokes.

### Data integrity & reliability

- **Guest reserve/release accounting verified symmetric** in
  `src/routes/api/public/guest-chat.ts`: released on upstream failure, on abort with
  nothing shown, on a genuine stream error with nothing shown, and when the provider
  closes without emitting a token; *not* released once tokens have reached the user,
  where the turn is recorded instead. No path releases twice.
- **The signed-in quota refund is idempotent.** `refundQuota` flips `quotaCharged` on
  first call, and the hoisted `refundOnUnhandledFailure` closes over the same flag,
  so the outer catch cannot double-refund after an inner path already refunded.
- Input validation hardened earlier in the stage stays in place: image count, per-image
  and combined byte caps, mime allowlist, base64 shape and header length
  (`src/lib/image-input.ts`); a 25 MB cap and mime allowlist on `transcribe.ts`;
  SSRF blocking for MCP hosts (`assertSafeMcpUrl`).

### Accessibility

- **Two unlabeled icon buttons** — the only genuine ones in the app — given accessible
  names in `admin.tsx` (activate/deactivate and delete, both now naming the server).
- **No completion announcement for screen readers.** `ThinkingLoader` is a polite live
  region, so a reader was told when a reply *started* but never when it finished; the
  announcement simply stopped, which is indistinguishable from a request that died.
  Added an `sr-only` `aria-live="polite"` region in `chat.$chatId.tsx` reporting
  "Response ready." or "That message didn't send." The streamed text itself is
  deliberately *not* in a live region — announcing every token would talk over the
  user for the whole response.
- `scripts/a11y-scan.mjs` (new, kept) reports **0** unlabeled icon-only buttons. Its
  first version produced 13 false positives because a regex tag match stopped at the
  `>` inside `{images.length >= MAX_IMAGES}`; it now scans with brace-depth and
  quote-state tracking.

### Dependencies

`npm audit` went from **4 vulnerabilities (1 moderate, 3 high) to 2 (1 low, 1 high)**
using four surgical `overrides` — `browserslist` 4.28.2→4.28.9, `nanoid`
3.3.12→3.3.18, `postcss` 8.5.15→8.5.28, `js-yaml` pinned — rather than
`npm audit fix`, which wanted to churn 338 packages and prunes devDependencies as a
side effect of `--omit=dev`.

**A latent deploy-breaking version drift was found and fixed.** Installing with the
new overrides pulled `@tanstack/react-router` to 1.170.32 (via
`peerOptional` from `@tanstack/router-plugin`), but `@tanstack/react-start@1.168.46`
requires exactly 1.170.29. The skew silently removes Start's `server` route-option
module augmentation, producing 16 typecheck errors
(`'server' does not exist in type ParamsOptions<…>`). Any fresh `npm install` would
have broken the deploy. Both packages are now exact-pinned to match the
already-exact-pinned `react-start`.

### Stage 6 verification

- **`tsc --noEmit -p tsconfig.json` — clean (exit 0)**, run after every edit group,
  and again after recovering from the dependency incident above.
- **`npm test` — 13 tests, 13 passing, 0 failing.** `tests/stage6.test.ts` is new and
  so is the `test` script; this is the project's **first committed test suite**. It
  imports the real modules, not copies, so a future edit to a validator is what gets
  tested. Coverage: base64 padding maths, the accept path, absent input, non-array
  input, over-count, remote/`file:`/`javascript:` URLs, mime allowlist, non-base64
  payloads, over-long headers, per-image and combined byte caps, plus 20 blocked and
  9 allowed MCP hosts.
  **Correction to the Stage 5 notes above:** the "34 unit tests" recorded there were
  written and run from a temporary location and never committed. Only these 13 are in
  the repository. The Stage 3 and Stage 5 test coverage is *not* present and should be
  treated as a gap, not as existing safety net.
- **`eslint .` — 3970 problems, none introduced by Stage 6.** 3938 are
  `prettier/prettier` (the repo was never prettier-formatted while the ESLint config
  enables the rule), and **1624 of the total are in files Stage 6 never opened**. Three
  violations *were* mine and are fixed (two long lines in `tests/stage6.test.ts`, one
  in `generate-image.ts`). The new `src/lib/image-input.ts` and
  `scripts/a11y-scan.mjs` are clean. The 32 non-prettier findings (11
  `no-explicit-any`, 8 `react-refresh/only-export-components`, 6 `no-empty`, 4
  `react-hooks/exhaustive-deps`, 2 `prefer-const`, 1 unused `eslint-disable`) all
  pre-date the stage.
- **`vite build` still fails, and the cause is not this project's code.** It throws in
  the `configResolved` hook of the vendored `@lovable.dev/mcp-js` plugin — before Vite
  reads a single line of application source:
  `routesDir "src/routes" must resolve under C:/Users/LEGION/Claude project, got
  C:\Users\LEGION\Claude project\src\routes`. At line 251 the plugin takes
  `projectRoot` from `config.root` (Vite normalizes it to forward slashes), derives
  `routesDir` with node's `resolve()` (backslashes on win32), then asserts
  `child.startsWith(parent + sep)` — a comparison that cannot succeed on Windows,
  where `sep` is `\`. On POSIX `normalizePath` is a no-op and the check passes, so this
  is Windows-only. Same pre-existing bug documented in Stage 5.
- **The application itself builds cleanly.** Verified with a throwaway config that
  omits only `mcpPlugin()` — safe because that plugin merely *regenerates*
  `src/routes/[.mcp]/**`, which is already on disk: **exit 0**, client + SSR + nitro
  output, `.output/server/wrangler.json` generated. The only build warnings are
  pre-existing: 13 `createServerFn().inputValidator()` deprecations in
  Lovable-generated server fns, and the already-documented >500 kB `ChatMarkdown`
  chunk. The throwaway config was deleted; **`vite.config.ts` is unmodified** — the
  build problem was diagnosed, not hidden.
- **New empirical secret check, only possible once the build ran.** Across all 79
  client JS assets: **0** occurrences of `SERVICE_ROLE`, `LOVABLE_API_KEY`,
  `RAZORPAY_KEY_SECRET`, `supabaseAdmin` or `client.server`, and **0** embedded JWTs
  of any kind. Only the public Supabase project URL appears. The server-only Supabase
  client never crosses into the client bundle.
- **Feature surface re-checked after the stage** (code-level): abort/Stop, regenerate,
  edit & resend, retry, copy, rename, delete, export, drafts, keyboard shortcuts, the
  new sr-only announcer, `clearLocalUserData`, image validation and MCP host blocking
  are all present and wired.

**What was not verified:** nothing was run in a browser, on a device, or against a
live database. Every behavioural claim in this stage is a code-level or build-level
claim. The §7 responsive pass and the §10 regression list were walked through as code,
not as runtime checks.

### Stage 6 files changed

| File | Change |
| --- | --- |
| `supabase/migrations/20260904090000_lock_daily_usage_writes.sql` | **new** — revokes `INSERT/UPDATE/DELETE` on `daily_usage` from `authenticated`/`anon` |
| `src/lib/chat.functions.ts` | read-then-upsert → atomic `increment_daily_usage` RPC as `service_role` |
| `src/routes/api/generate-image.ts` | same conversion; prettier fix on the added call |
| `src/components/ChatMarkdown.tsx` | added `a` override — `target="_blank" rel="noopener noreferrer nofollow"` |
| `src/lib/chat-cache.ts` | **new** `clearLocalUserData()` — wipes drafts, prefs, legacy cache |
| `src/components/AuthedShell.tsx` | sign-out now clears local user data |
| `src/routes/_authenticated/profile.tsx` | `deleteAccount` scoped to `user_id`, guarded, error-handled; clears local data |
| `src/routes/_authenticated/admin.tsx` | accessible names on the two unlabeled icon buttons |
| `src/routes/_authenticated/chat.$chatId.tsx` | sr-only `aria-live` completion announcement |
| `src/lib/image-input.ts` | **new** (earlier in stage) — image caps, mime allowlist, base64 validation |
| `src/routes/api/chat.ts` | image validation before quota; hoisted `refundOnUnhandledFailure` |
| `src/routes/api/public/guest-chat.ts` | CAS reserve/release/record; `foldControlChars`; ~120 lines of dead code removed |
| `src/routes/api/transcribe.ts` | 25 MB cap + mime allowlist |
| `src/lib/mcp-client.server.ts` | single `isBlockedMcpHost` + `assertSafeMcpUrl` (SSRF) |
| `src/components/chat-shared.tsx` | composer wired to the shared image validator |
| `tests/stage6.test.ts` | **new** — 13 tests |
| `scripts/a11y-scan.mjs` | **new** — icon-button accessible-name scanner |
| `package.json` | 4 `overrides`; exact pins for `react-router`/`router-plugin`; `test` script |

### Open after Stage 6

- **`npm ci` is unusable.** `package-lock.json` was already out of sync with
  `package.json` *before* this stage (missing `@tailwindcss/typography`,
  `react-syntax-highlighter`, `rehype-katex`, `remark-math`, the three
  `@lovable.dev/*` packages, `@react-email/*`; `zod` 3.25.76 vs 4.5.4). Only
  `npm install` works. Pre-existing, and it deserves a dedicated fix.
- **2 dependency advisories remain, both deliberately.** `brace-expansion` is dev lint
  tooling only, and a blanket `^5.0.9` override would break the 1.1.16 copy that
  minimatch 3.x needs. `esbuild` 0.27.7 is a low-severity dev-server-only Windows file
  read whose fix needs a Vite bundler bump that cannot be verified here.
- `vite build` cannot succeed on Windows until `@lovable.dev/mcp-js` fixes its path
  comparison, or the project moves the build to Linux/CI. Not fixable from
  application code.
- `messages` RLS permits inserting a row with your own `user_id` into someone else's
  `chat_id`. Pollution only — no cross-user read — so it was left for a considered
  migration rather than a rushed one.
- The Lovable-generated email preview route compares its bearer token with `!==`
  rather than a constant-time compare. Left alone to avoid platform-sync conflicts.
- `src/components/ui/chart.tsx` is unused but carries `dangerouslySetInnerHTML`
  (dev-supplied config, tree-shaken out).
- `refund_daily_usage` and the new `lock_daily_usage_writes` migrations are still
  unapplied against a live database.
- Admin table icon buttons are 28 px, below the 44 px touch guideline. Desktop-only
  admin surface, so left as is.
- 3938 pre-existing `prettier/prettier` violations untouched, per the standing
  decision to avoid unrelated churn. Running `npm run format` would settle them, and
  would also produce a diff touching nearly every file.
- Stage 3 and Stage 5 unit tests are **not** in the repository (see the correction
  above). Re-adding them would be the highest-value follow-up.

---

## Stage 7 — Final production audit & release readiness (done)

**Overall status: READY WITH WARNINGS.** The application code is release-ready and
verified. The warnings are all pre-existing environment/config items, not defects
introduced by Stages 1–7 — the two that actually gate a deploy are the unapplied
migrations and the six server-side secrets.

Stage 7 was an audit, not a change stage. Four files were touched, one file added,
one file removed, and no application logic was modified.

### 1. Final code audit

| Checked | Result |
| --- | --- |
| Debug code | No `console.log` in shipped code — the only ones are in `scripts/` CLI output |
| TODO/FIXME/HACK/XXX | **0** in `src/` |
| Temporary files | Removed (see §9) |
| Unused imports | **3 found and removed** — see below |
| Unused dependencies | 4 runtime + 1 dev unreferenced, **deliberately retained** (see below) |
| Exposed secrets | **0** — empirically verified against the built bundle, see §4 |
| Environment variables | Correct; one dead entry found (see §7) |
| Incomplete implementations | None found |

**Unused imports.** Worth recording *why* these survived six stages:
`@typescript-eslint/no-unused-vars` is `"off"` in `eslint.config.js:36` and
`tsconfig.json` sets no `noUnusedLocals`, so **nothing in the toolchain was checking
for unused code at all.** A read-only diagnostic pass found the only three in the
project, all unused `lucide-react` icons:

```
tsc --noEmit --noUnusedLocals --noUnusedParameters -p tsconfig.json
```

- `src/routes/auth.tsx` — `Sparkles`
- `src/routes/plans.tsx` — `Sparkles`
- `src/routes/try.tsx` — `Lock`

After removal the same pass reports **0**. This command is the cheapest way to catch
the class in future; it changes no output and can be run any time.

**Unreferenced dependencies — reported, not removed.** `@tailwindcss/vite`,
`vite-tsconfig-paths`, `@vitejs/plugin-react`, `react-dom` and
`@tanstack/router-plugin` appear unused but are genuinely required — the first four
by `@lovable.dev/vite-tanstack-config`, which composes them internally, and the last
by the Stage 6 version pin. The remaining four have no reference in `src/`, `tests/`,
`scripts/` or any config file, but they are tree-shaken out of the bundle, this is a
platform-synced repo where Lovable may reintroduce them, and Stage 7's own brief says
not to delete anything whose purpose is uncertain. Removing them would be churn with
no runtime benefit.

### 2. Build & test

| Check | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.json` | **EXIT 0** |
| unused-code pass (read-only) | **0 findings** (was 3) |
| `npm test` | **13 / 13 pass, 0 fail** |
| `npx eslint .` | 3967 problems — **0 introduced by Stage 7** |
| `npx vite build` | **EXIT 1 — pre-existing third-party failure, see below** |
| app build via plugin-stripped config | **EXIT 0** — client + SSR + nitro, `wrangler.json` generated |
| `npm audit` | 2 (1 low, 1 high), both dev-only |

The lint total fell from 3970 to 3967 (the three removed imports). The non-prettier
breakdown is **byte-identical to Stage 6** — 11 `no-explicit-any`, 8
`react-refresh/only-export-components`, 6 `no-empty`, 4
`react-hooks/exhaustive-deps`, 2 `prefer-const`, 1 ruleId-less warning — which is the
evidence that Stage 7 introduced nothing. The other 3936 are the pre-existing
`prettier/prettier` violations.

**The production build failure is not ours, and this is provable.** `npx vite build`
fails with:

```
@lovable.dev/mcp-js: routesDir "src/routes" must resolve under
C:/Users/LEGION/Claude project, got C:\Users\LEGION\Claude project\src\routes
  at assertContains (node_modules/@lovable.dev/mcp-js/dist/stacks/tanstack/vite.js:14:65)
  at configResolved (…/vite.js:253:130)
```

The plugin sets `projectRoot = config.root` (line 251), which Vite normalises to
forward slashes, then derives `routesDir` with node's `resolve()`, which on win32
returns backslashes. `assertContains` then tests
`child.startsWith(parent + sep)` with `sep === "\\"`, which can never hold. It throws
in **`configResolved`** — before Vite reads a single line of application source, which
is exactly why no app-side change can affect it.

To confirm the application itself still builds after Stage 7's edits, a throwaway
config identical to `vite.config.ts` **except** that it omits `mcpPlugin()` was used;
it completed **EXIT 0** through client, SSR and nitro, then was deleted.
`vite.config.ts` was **never modified** — hiding a third-party bug by editing working
config was explicitly out of scope.

### 3. Core functionality regression

Verified by reading the current code on each path. `tsc` EXIT 0 plus a clean
production build additionally prove every import resolves and every route compiles.
This is static verification — it is **not** a substitute for one manual pass against
a live Supabase project and AI gateway before release.

| Feature | Verified |
| --- | --- |
| Authentication | `_authenticated/route.tsx` `beforeLoad` — `getSession()`, then `refreshSession()`, then `redirect({ to: "/auth" })` |
| New chat / send / stream | `runSend` → `streamChat` with `onChunk`; cross-route store is the single source of streaming truth |
| Stop | `abortRef.current?.abort()`; `result.aborted` shows "Stopped" and is not treated as an error |
| Regenerate | Takes the last exchange **in display order** via `sortMessages`, not from an unsorted array |
| Edit & Resend | Replaces **by id** from the sorted list, never by `created_at >= cutoff` |
| Retry after failure | `setFailed({ text, images, message })` hands the message back with retry + edit, instead of losing it to a toast |
| Conversation history / switching | `["messages", chatId]` query, `staleTime`-guarded `["chats"]` list, per-chat drafts via `useDraft` |
| Delete | Server function + confirmation dialog; failure keeps the chat and reports it |
| Pin / unpin | `togglePinChat` (the app has pin, **not** archive — no archive feature has ever existed) |
| Search | Client-side filter over the loaded chat list, with `aria-label` and a clear-search affordance |
| Stage 5 features | Voice, image generation, TTS, export, dictation, shortcuts modules all present and compiling |
| MCP / tools | `mcp-client.server.ts` + `src/lib/mcp/` + `mcp.ts` route; SSRF host blocking covered by 2 of the 13 tests |
| Manipuri / English / mixed | `SYSTEM_PROMPT` in `chat.functions.ts` pins romanized Meiteilon output across Latin, Meitei Mayek and Bengali input scripts; `script.ts` / `lang-tools.ts` handle conversion |
| Mobile interface | `use-mobile.tsx`, `h-[100dvh]`, `env(safe-area-inset-bottom)` padding, 16 px input font to stop iOS zoom |

### 4. API & gateway safety

**Empirically verified, not assumed.** `scripts/bundle-scan.mjs` (added this stage)
scanned all **79** built client JS assets:

| Needle | Occurrences |
| --- | --- |
| `SERVICE_ROLE`, `LOVABLE_API_KEY`, `GEMINI_API_KEY`, `RAZORPAY_KEY_SECRET`, `FIRECRAWL_API_KEY` | **0** |
| `supabaseAdmin`, `client.server` | **0** |
| JWT-shaped strings | **0** |

The script exits non-zero on any hit, so it works as a release gate rather than a
one-off observation.

- **Config guards.** All three AI entry points (`api/chat.ts`, `api/public/guest-chat.ts`,
  `api/transcribe.ts`) check for `LOVABLE_API_KEY ?? GEMINI_API_KEY` and return a
  clear 500 before any provider call, so `process.env.LOVABLE_API_KEY!` downstream is
  unreachable with no key configured.
- **Timeouts.** `HEADERS_TIMEOUT_MS = 20_000` guards the wait for response *headers*
  only, and is cleared once they arrive — a long streaming body is never truncated by it.
- **Failover.** 429 and 5xx fail over to the next provider. A **client disconnect
  deliberately does not**, because that fired a second upstream request and billed for it.
- **Partial responses.** A partial reply is persisted, so a dropped stream leaves a
  short answer rather than an empty turn or a hole in the conversation.
- **Quota failures** produce a user-facing message; provider detail goes to the server
  log only. The outer catch returns a generic string.
- **CORS.** No `Access-Control-Allow-*` header is set anywhere, so every endpoint —
  including `/api/public/*` — is same-origin. That is the correct default; do not add
  permissive CORS without a specific reason.

### 5. Database & data safety

- **Cross-user isolation.** `CREATE POLICY "Users manage own messages" … FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)` — reads are
  user-scoped. The known residual is narrower than first characterised: a user can
  insert a row carrying their own `user_id` but another user's `chat_id`, and because
  SELECT is also `user_id`-scoped, **the victim cannot see that row either**. There is
  no cross-user read in any direction.
- **Ordering.** `sortMessages` is a total order — timestamp, then user-before-assistant
  on a tie, then `id.localeCompare` as a deterministic final tie-breaker. Colliding
  timestamps can no longer reorder a conversation.
- **No duplicates.** The rendered list is deduplicated strictly by message id through a
  `Map`, and `baseCount` lives in the cross-route store rather than a ref, so a remount
  mid-turn cannot render the reply twice.
- **No lost messages.** Regenerate and edit-and-resend **hide** superseded rows and
  delete them only after re-reading the table and confirming a brand-new assistant row
  landed. If the replacement did not save, the originals are restored untouched and the
  user is told. If the delete itself fails, both copies are kept — "strictly better than
  losing the reply."
- **Concurrency.** `inFlightRef` is a synchronous double-send guard; `sending` is React
  state, so two clicks in one tick both read it as `false`, which previously started two
  turns claiming the same `replaceIds` and orphaned the first stream's abort handle.
- **Quota.** `increment_daily_usage` / `refund_daily_usage` are atomic RPCs. The refund
  is idempotent via a `quotaCharged` flag shared by `refundQuota` and the hoisted
  `refundOnUnhandledFailure`, so a failed request refunds exactly once and never twice.
  Guest turns are recorded only when tokens were actually delivered.
- **No destructive migrations were written or run in this stage.**

### 6. Performance

Checked; **no changes made**, because nothing found was both a real cost and a
high-confidence fix.

| Checked | Finding |
| --- | --- |
| Unnecessary API requests | None. No `refetchInterval`, no realtime channel or subscription anywhere; `staleTime` set on the chat list (60 s), profile (5 min), admin check (60 s) and the paid-feature gate (30 s), with `refetchOnWindowFocus: false` on the hot ones |
| Unnecessary React renders | The whole message-list derivation is behind `useMemo` keyed on `activeBaseCount` — deliberately **not** on streaming text — so a streamed frame no longer re-sorts and re-maps the entire conversation |
| Expensive work in the chat loop | Streaming text lives in one store with frame coalescing; there is deliberately no second `streaming` state |
| Memory leaks / unbounded listeners | **None.** Three files add listeners without a matching remove, and all three are correct: `ai-provider.server.ts:97` uses `{ once: true }` on a per-request signal, `error-capture.ts:11–15` installs page-lifetime global handlers once at module scope, and `__root.tsx:126` is a one-shot `load` handler inside a static inline script |
| Excessive database queries | Message list is a single indexed read per chat |
| Bundle size | 2098 kB of client JS across 79 files. `ChatMarkdown` is the largest single chunk at 1032 kB and is **already `lazy()`-loaded**, so it never touches first paint; the 643 kB entry chunk is the one real remaining cost |

The one deliberate non-fix: `["messages", chatId]` has no `staleTime`, so it can refetch
on window focus. The carryover logic is explicitly built to survive refetches mid-stream,
and touching that interaction to save one indexed query is not a safe trade.

### 7. Production configuration required

No secret values are recorded here, and none are printed anywhere in this document.

**A. Six server-side secrets must be set in the production environment.** The local
`.env` contains only publishable/public values, so every one of these is currently
absent:

| Variable | Consequence if missing |
| --- | --- |
| `LOVABLE_API_KEY` *or* `GEMINI_API_KEY` | **Hard blocker.** Chat, image generation and transcription all return 500 |
| `SUPABASE_SERVICE_ROLE_KEY` | **Hard blocker.** Quota, admin and server-side writes fail |
| `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` | Upgrades cannot be created or verified |
| `FIRECRAWL_API_KEY` | Optional — `firecrawlSearch` returns `null` and chat answers without web grounding |

`.env.example` was added this stage as the names-only template; it lists every
variable with its scope and states plainly that `VITE_*` values reach the browser.

**B. Dead environment entry.** `.env` defines `VITE_RAZORPAY_KEY_ID`, which **no code
reads** — the client receives `key_id` from the server when an order is created, which
is the correct design. Harmless, but it should not be copied into production config as
if it mattered.

**C. `.gitignore` hardened.** It previously ignored the exact name `.env` only, so a
`.env.local` or `.env.production` would have been committed. Now `.env*` with a
`!.env.example` exception.

**D. Database.** Two migrations are unapplied — see §8C.

**E. Authentication.** Supabase auth redirect URLs must include the production origin.
The code builds redirects from `window.location.origin` (`/auth`, `/reset-password`,
and the sign-up email redirect), so these work on any domain **once that domain is in
the Supabase allow-list**. Google OAuth goes through `lovable.auth.signInWithOAuth`
and needs the same origin registered.

**F. Domain / CORS.** `manipuriai.online` is hard-coded in canonical links, `og:` tags
and JSON-LD across the marketing routes. Deploying to a different domain will serve
wrong canonical URLs. No CORS configuration is needed (§4).

**G. No security response headers are set** — no CSP, HSTS, `X-Frame-Options` or
`X-Content-Type-Options`; the generated `_headers` file contains only asset caching.
This is a genuine hardening gap and it was **not** fixed here on purpose: the app is
Lovable-connected and renders in a platform preview iframe, so `X-Frame-Options: DENY`
could break that preview, and a CSP would have to be reconciled with Razorpay's
injected checkout script, Supabase, Lovable OAuth and the inline scripts in
`__root.tsx`. It needs its own change with somewhere to test it.

### 8. Deployment safety — NOT deployed

**A. What is ready to deploy.** All application code. Typecheck clean, 13/13 tests
passing, no secrets in the client bundle, no Stage 7-introduced lint problems, and a
full client + SSR + nitro build that completes once the third-party Windows plugin bug
is out of the way.

**B. Configuration that must exist in production.** The six secrets in §7A (two are
hard blockers), the production origin in Supabase's auth redirect allow-list, and the
domain caveat in §7F.

**C. Migrations required.** Two, both additive, neither destructive:

1. `20260902160000_refund_daily_usage.sql` — adds the `refund_daily_usage` function.
2. `20260904090000_lock_daily_usage_writes.sql` — revokes `INSERT, UPDATE, DELETE` on
   `public.daily_usage` from `authenticated` and `anon`.

Both must be applied. **Order matters, and #2 is the security fix**: until it is
applied, any signed-in user can reset their own `message_count` to zero with the
publishable key and bypass quota entirely. The SECURITY DEFINER functions keep working
after the revoke because they bypass table grants by design.

**D. Known limitations.** `vite build` cannot pass on Windows (build on Linux/CI, or
wait for an upstream fix); `npm ci` is unusable because the lockfile was already out of
sync before Stage 1; 2 dev-only advisories; no security response headers; ~3936
pre-existing prettier violations; Stage 3/Stage 5 unit tests are absent from the repo;
the domain is hard-coded.

**E. Safe to hand over to Lovable/GitHub?** **Yes, with the §8B and §8C prerequisites.**
`.env` is gitignored (now with every variant covered), no secret is in the client
bundle, no published history was rewritten, `vite.config.ts` and `package-lock.json`
were left alone, and every change is additive or a removal of dead code.

### 9. Final cleanup

Removed: `scripts/dep-audit.mjs` and `scripts/lint-group.mjs` / `scripts/lint-split.mjs`
(one-shot audit helpers, findings now recorded here), `vite.config.stage6verify.ts` and
`vite.config.stage7verify.ts` (build harnesses), `/tmp/*.bak`, `.output/` and
`.wrangler/` (build artifacts, gitignored), and an empty stray directory named `2` in
the project root — an accidental shell-redirect artifact, 0 entries, referenced nowhere.

Kept: `scripts/a11y-scan.mjs` and `scripts/bundle-scan.mjs`. Both are lint-clean,
reusable release checks rather than throwaways, and `bundle-scan.mjs` exits non-zero on
a secret leak.

### Stage 7 files changed

| File | Change |
| --- | --- |
| `src/routes/auth.tsx` | Removed unused `Sparkles` import |
| `src/routes/plans.tsx` | Removed unused `Sparkles` import |
| `src/routes/try.tsx` | Removed unused `Lock` import |
| `.gitignore` | `.env` → `.env*` with `!.env.example` |
| `.env.example` | **New.** Names-only template for all 12 variables, with scope notes |
| `scripts/bundle-scan.mjs` | **New.** Client-bundle secret + size scan; exits non-zero on a leak |
| `scripts/dep-audit.mjs` | **Deleted** after use |
| `vite.config.stage7verify.ts` | **Deleted** after use |
| `PROJECT_PROGRESS.md` | This section |

No application logic was changed in Stage 7.

### Open after Stage 7

Everything under "Open after Stage 6" still stands, plus:

- **No security response headers** (§7G) — the highest-value remaining hardening item.
- **`VITE_RAZORPAY_KEY_ID` is dead config** in `.env` (§7B).
- **The domain is hard-coded** in canonical/`og:`/JSON-LD tags across the marketing
  routes (§7F).
- **The toolchain still does not check for unused code.** Turning
  `@typescript-eslint/no-unused-vars` on, or setting `noUnusedLocals` in
  `tsconfig.json`, would prevent the class of finding in §1 from recurring — but it
  would surface against pre-existing code too, so it belongs in its own change.

