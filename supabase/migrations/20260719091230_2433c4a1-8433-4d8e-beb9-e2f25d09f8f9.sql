
-- Attach plan-tamper safeguard to profiles
DROP TRIGGER IF EXISTS profiles_prevent_plan_self_upgrade ON public.profiles;
CREATE TRIGGER profiles_prevent_plan_self_upgrade
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_plan_self_upgrade();

-- Restrict SECURITY DEFINER RPC to service_role only
REVOKE EXECUTE ON FUNCTION public.increment_daily_usage(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_daily_usage(uuid, date) TO service_role;
