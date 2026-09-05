-- Quota rows must not be writable by the account they meter.
--
-- 20260816065124 correctly reduced authenticated to SELECT on public.daily_usage,
-- but 20260816065545 re-granted INSERT, UPDATE, DELETE a few minutes later while
-- restoring an unrelated set of grants. Combined with the (correct) "Users insert
-- own usage" / "Users update own usage" policies, that let any signed-in client
-- run `update daily_usage set message_count = 0` — or delete the row outright —
-- against its own row with the publishable key, resetting the free-tier daily
-- limit at will. The limit check itself was never the weak part; the counter was.
--
-- Every legitimate write already happens server-side: /api/chat increments through
-- the atomic public.increment_daily_usage RPC as service_role, and the remaining
-- upserts were moved onto the same RPC alongside this migration. So the app needs
-- no write grant here at all.
REVOKE INSERT, UPDATE, DELETE ON public.daily_usage FROM authenticated, anon;
GRANT SELECT ON public.daily_usage TO authenticated;
GRANT ALL ON public.daily_usage TO service_role;

-- The own-row RLS policies are deliberately left in place. They are now redundant
-- behind the missing grant, but they are the layer that still isolates one user's
-- usage row from another's if a future migration re-grants writes the way
-- 20260816065545 did.
