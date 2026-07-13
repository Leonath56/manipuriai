ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS chats_pinned_updated_idx ON public.chats (user_id, pinned DESC, updated_at DESC);