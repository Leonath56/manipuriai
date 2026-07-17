
-- Prevent users from upgrading their own plan via direct RLS update.
-- Only service_role (server-side payment verification) can change plan.
CREATE OR REPLACE FUNCTION public.prevent_plan_self_upgrade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan
     AND current_setting('role', true) <> 'service_role' THEN
    NEW.plan := OLD.plan;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_plan_self_upgrade_trg ON public.profiles;
CREATE TRIGGER prevent_plan_self_upgrade_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_plan_self_upgrade();
