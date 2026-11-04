-- Aggregate-only Gemini API usage log. No prompts, no message content, no keys.
CREATE TABLE public.gemini_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  is_guest BOOLEAN NOT NULL DEFAULT false,
  model TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'instant',
  source TEXT NOT NULL DEFAULT 'chat',
  purpose TEXT NOT NULL DEFAULT 'main',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  api_calls INTEGER NOT NULL DEFAULT 1,
  cost_estimate_inr NUMERIC(12,6) NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-only table: written and read exclusively through the service role
-- (admin dashboard reads via supabaseAdmin after an admin role check).
GRANT ALL ON public.gemini_usage TO service_role;
ALTER TABLE public.gemini_usage ENABLE ROW LEVEL SECURITY;

CREATE INDEX gemini_usage_created_at_idx ON public.gemini_usage (created_at DESC);
CREATE INDEX gemini_usage_user_idx ON public.gemini_usage (user_id, created_at DESC);

-- Rolling conversation summary: lets long chats send a compact summary instead
-- of the full old history. summarized_count = how many of the oldest messages
-- the summary covers.
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS summarized_count INTEGER NOT NULL DEFAULT 0;