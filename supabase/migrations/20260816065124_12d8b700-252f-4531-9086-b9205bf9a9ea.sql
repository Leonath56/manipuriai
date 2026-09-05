
-- 1. Tighten RLS for guest_sessions and guest_messages
ALTER TABLE public.guest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view guest sessions" ON public.guest_sessions;
CREATE POLICY "Admins can view guest sessions" 
ON public.guest_sessions FOR SELECT 
TO authenticated 
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can view guest messages" ON public.guest_messages;
CREATE POLICY "Admins can view guest messages" 
ON public.guest_messages FOR SELECT 
TO authenticated 
USING (public.has_role(auth.uid(), 'admin'));

-- 2. Audit and ensure proper GRANTS for all tables
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats TO authenticated;
GRANT ALL ON public.chats TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

GRANT SELECT ON public.mcp_servers TO authenticated;
GRANT ALL ON public.mcp_servers TO service_role;

GRANT SELECT, INSERT ON public.manipuri_corrections TO authenticated;
GRANT ALL ON public.manipuri_corrections TO service_role;

GRANT SELECT ON public.daily_usage TO authenticated;
GRANT ALL ON public.daily_usage TO service_role;

GRANT SELECT ON public.guest_sessions TO authenticated;
GRANT ALL ON public.guest_sessions TO service_role;
GRANT SELECT ON public.guest_messages TO authenticated;
GRANT ALL ON public.guest_messages TO service_role;

GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

-- 3. MCP Server URL uniqueness check
ALTER TABLE public.mcp_servers ADD CONSTRAINT mcp_servers_url_key UNIQUE (url);
