CREATE OR REPLACE FUNCTION public.refund_daily_usage(_user_id uuid, _usage_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_count integer;
BEGIN
  UPDATE public.daily_usage
  SET message_count = GREATEST(message_count - 1, 0)
  WHERE user_id = _user_id AND usage_date = _usage_date
  RETURNING message_count INTO new_count;
  RETURN COALESCE(new_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.refund_daily_usage(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_daily_usage(uuid, date) TO service_role;