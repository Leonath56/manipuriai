REVOKE ALL ON public.mcp_servers FROM anon;
DROP POLICY IF EXISTS "Users can view active MCP servers" ON public.mcp_servers;
DROP POLICY IF EXISTS "Anyone can view active MCP servers" ON public.mcp_servers;
GRANT ALL ON public.mcp_servers TO service_role;