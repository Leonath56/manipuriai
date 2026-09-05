
CREATE TABLE public.guest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id text NOT NULL UNIQUE,
  name text NOT NULL,
  message_count integer NOT NULL DEFAULT 0,
  user_agent text,
  ip_hint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.guest_sessions TO service_role;
ALTER TABLE public.guest_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.guest_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_session_id uuid NOT NULL REFERENCES public.guest_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.guest_messages TO service_role;
ALTER TABLE public.guest_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX guest_messages_session_idx ON public.guest_messages(guest_session_id, created_at);
CREATE INDEX guest_sessions_updated_idx ON public.guest_sessions(updated_at DESC);
