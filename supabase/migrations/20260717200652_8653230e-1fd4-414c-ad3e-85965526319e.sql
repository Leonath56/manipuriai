-- Remove user-facing UPDATE on payments; only service_role (server-side verified) should mutate payment rows.
DROP POLICY IF EXISTS "Users update their own payments" ON public.payments;