
-- Ensure service_role has access (already granted, but good to ensure consistency)
GRANT ALL ON public.guest_sessions TO service_role;
GRANT ALL ON public.guest_messages TO service_role;

-- RLS is enabled, but we need policies for the admin panel to view them
-- (since admin functions use supabaseAdmin which bypasses RLS, these are mainly for defense in depth)
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

-- Note: Guest sessions are currently handled by service_role in trial functions,
-- so we don't grant authenticated/anon access to insert/update.
