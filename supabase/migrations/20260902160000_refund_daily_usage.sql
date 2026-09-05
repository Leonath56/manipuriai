-- Give a consumed daily message back when the request never produced a reply.
--
-- increment_daily_usage() has to run before the model call (it is the only way
-- to make the quota check atomic), so a stopped, failed or empty generation
-- would otherwise still burn one of the user's daily messages.
--
-- Mirrors increment_daily_usage(): SECURITY DEFINER, pinned search_path, and
-- callable only by service_role — the API route holds the service key, clients
-- must never be able to hand themselves free messages.

CREATE OR REPLACE FUNCTION public.refund_daily_usage(_user_id uuid, _usage_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  UPDATE public.daily_usage
     SET message_count = GREATEST(0, message_count - 1)
   WHERE user_id = _user_id
     AND usage_date = _usage_date
  RETURNING message_count INTO new_count;

  RETURN COALESCE(new_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.refund_daily_usage(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_daily_usage(uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.refund_daily_usage(uuid, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refund_daily_usage(uuid, date) TO service_role;
