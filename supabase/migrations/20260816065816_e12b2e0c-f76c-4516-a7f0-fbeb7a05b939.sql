
DROP POLICY IF EXISTS "Users can view active MCP servers" ON public.mcp_servers;
DROP POLICY IF EXISTS "Authenticated users can see active servers" ON public.mcp_servers;

DROP POLICY IF EXISTS "Admins can view MCP servers" ON public.mcp_servers;
CREATE POLICY "Admins can view MCP servers"
ON public.mcp_servers FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
