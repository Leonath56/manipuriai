DROP POLICY IF EXISTS "Users insert their own payments" ON public.payments;
DROP POLICY IF EXISTS "Users update their own payments" ON public.payments;
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;