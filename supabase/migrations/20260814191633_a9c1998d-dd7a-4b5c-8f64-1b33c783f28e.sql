
-- 1. Tighten user_roles table security
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;

CREATE POLICY "Admins can view all roles" 
ON public.user_roles FOR SELECT 
TO authenticated 
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their own roles" 
ON public.user_roles FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;

-- 2. Audit MCP servers security
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage MCP servers" ON public.mcp_servers;
DROP POLICY IF EXISTS "Anyone can view active MCP servers" ON public.mcp_servers;
DROP POLICY IF EXISTS "Authenticated users can see active servers" ON public.mcp_servers;

CREATE POLICY "Admins can manage MCP servers" 
ON public.mcp_servers FOR ALL 
TO authenticated 
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can see active servers" 
ON public.mcp_servers FOR SELECT 
TO authenticated 
USING (is_active = true);

-- 3. Ensure all tables have proper GRANTS
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

GRANT SELECT ON public.mcp_servers TO authenticated;
GRANT ALL ON public.mcp_servers TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats TO authenticated;
GRANT ALL ON public.chats TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
