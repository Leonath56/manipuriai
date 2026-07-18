
CREATE OR REPLACE FUNCTION public.increment_daily_usage(_user_id uuid, _usage_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO public.daily_usage (user_id, usage_date, message_count, updated_at)
  VALUES (_user_id, _usage_date, 1, now())
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET message_count = public.daily_usage.message_count + 1,
                updated_at = now()
  RETURNING message_count INTO new_count;
  RETURN new_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_daily_usage(uuid, date) TO authenticated;
