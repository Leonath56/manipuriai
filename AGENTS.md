<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Text-chat completions share the Google-only fetchChatCompletion helper; legacy provider routing is restricted to existing voice/media paths so chat cannot spend Lovable AI credits or silently change providers.
- Gemini usage is logged aggregate-only (no prompts/content/keys) to public.gemini_usage via src/lib/gemini-usage.server.ts; the table is service-role only and read solely by the admin-gated getGeminiUsage function. Cost figures are estimates from the configurable GEMINI_PRICING_INR_PER_1M table.
- Long chats keep context through a rolling summary on chats.summary/summarized_count, refreshed in the background only when shouldRefreshSummary() passes — never on the reply's critical path or on every message.
