-- get_effective_plan takes an arbitrary user id; only server code (service role)
-- may call it. Client reads go through profiles RLS or an auth-scoped server fn.
REVOKE EXECUTE ON FUNCTION public.get_effective_plan(uuid) FROM authenticated;