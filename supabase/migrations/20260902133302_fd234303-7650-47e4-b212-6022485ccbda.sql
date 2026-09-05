-- Payments: writes are service-role only
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated, anon;
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

-- Prevent users from self-upgrading their plan via profiles UPDATE
CREATE OR REPLACE FUNCTION public.prevent_plan_self_upgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND NOT private.has_role(auth.uid(), 'admin'::app_role) THEN
      RAISE EXCEPTION 'Plan changes are not allowed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_plan_self_upgrade ON public.profiles;
CREATE TRIGGER prevent_plan_self_upgrade
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_plan_self_upgrade();