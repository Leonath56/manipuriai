
CREATE TABLE public.manipuri_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  original_text text not null,
  corrected_text text not null,
  note text,
  language text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

GRANT SELECT, INSERT ON public.manipuri_corrections TO authenticated;
GRANT ALL ON public.manipuri_corrections TO service_role;

ALTER TABLE public.manipuri_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own corrections"
  ON public.manipuri_corrections FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own corrections"
  ON public.manipuri_corrections FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_manipuri_corrections_user ON public.manipuri_corrections(user_id, created_at desc);
CREATE INDEX idx_manipuri_corrections_status ON public.manipuri_corrections(status, created_at desc);
