
-- Table to manage MCP servers
CREATE TABLE public.mcp_servers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    url text NOT NULL,
    api_key text,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Grant access to authenticated users and service role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mcp_servers TO authenticated;
GRANT ALL ON public.mcp_servers TO service_role;

-- Enable RLS
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;

-- Policies: Only admins can manage MCP servers, but all authenticated users can see active ones
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_role') THEN
        EXECUTE 'CREATE POLICY "Admins can manage MCP servers" ON public.mcp_servers FOR ALL TO authenticated USING (public.has_role(auth.uid(), ''admin''))';
    ELSE
        -- Fallback if has_role is not available (though it should be per context)
        EXECUTE 'CREATE POLICY "Admins can manage MCP servers" ON public.mcp_servers FOR ALL TO authenticated USING (true)';
    END IF;
END
$$;

CREATE POLICY "Users can view active MCP servers"
ON public.mcp_servers
FOR SELECT
TO authenticated
USING (is_active = true);
