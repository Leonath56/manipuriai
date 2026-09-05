REVOKE ALL ON public.payments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.payments FROM authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;