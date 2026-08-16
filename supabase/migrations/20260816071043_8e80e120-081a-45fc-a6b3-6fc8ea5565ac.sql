
-- 1. Explicitly grant execute on has_role and its types
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

-- 2. Drop the recursive policy on user_roles
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;

-- 3. Ensure the base policy for self-viewing exists and is correct
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
