-- 1. Subscription window columns on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_start timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_end timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'free';

-- 2. Per-user image generation usage, one row per user, reset per period
CREATE TABLE IF NOT EXISTS public.image_usage (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date NOT NULL DEFAULT CURRENT_DATE,
  used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.image_usage TO authenticated;
GRANT ALL ON public.image_usage TO service_role;

ALTER TABLE public.image_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own image usage"
  ON public.image_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 3. Effective plan resolver: lazily expires overdue subscriptions.
--    Returns the plan the user is actually entitled to RIGHT NOW.
CREATE OR REPLACE FUNCTION public.get_effective_plan(_user_id uuid)
RETURNS TABLE(plan text, subscription_start timestamptz, subscription_end timestamptz, subscription_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
  r public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.profiles WHERE id = _user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'free'::text, NULL::timestamptz, NULL::timestamptz, 'free'::text;
    RETURN;
  END IF;

  IF r.plan IN ('pro','max')
     AND r.subscription_end IS NOT NULL
     AND r.subscription_end <= now() THEN
    -- Lazily downgrade: expired paid plans lose access immediately, server-side.
    UPDATE public.profiles
      SET plan = 'free', subscription_status = 'expired', updated_at = now()
      WHERE id = _user_id;
    RETURN QUERY SELECT 'free'::text, r.subscription_start, r.subscription_end, 'expired'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT r.plan::text, r.subscription_start, r.subscription_end,
    CASE WHEN r.plan IN ('pro','max') THEN 'active' ELSE r.subscription_status END;
END;
$func$;

REVOKE ALL ON FUNCTION public.get_effective_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_plan(uuid) TO authenticated, service_role;

-- 4. Atomic image-credit consumption. One row per user; the period resets
--    only when the stored period_start is older than the current period
--    (subscription month for paid users, calendar month for free users).
--    Returns remaining credits, or -1 when the request would exceed the limit.
CREATE OR REPLACE FUNCTION public.consume_image_credits(
  _user_id uuid,
  _count integer,
  _limit integer DEFAULT 3,
  _period_start date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
  period date := COALESCE(_period_start, date_trunc('month', now())::date);
  new_used integer;
BEGIN
  INSERT INTO public.image_usage (user_id, period_start, used, updated_at)
  VALUES (_user_id, period, _count, now())
  ON CONFLICT (user_id) DO UPDATE SET
    used = CASE
      WHEN public.image_usage.period_start < period THEN _count
      ELSE public.image_usage.used + _count
    END,
    period_start = GREATEST(public.image_usage.period_start, period),
    updated_at = now()
  RETURNING used INTO new_used;

  IF new_used > _limit THEN
    -- Roll the increment back; the request is rejected.
    UPDATE public.image_usage
      SET used = used - _count, updated_at = now()
      WHERE user_id = _user_id;
    RETURN -1;
  END IF;

  RETURN _limit - new_used;
END;
$func$;

REVOKE ALL ON FUNCTION public.consume_image_credits(uuid, integer, integer, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_image_credits(uuid, integer, integer, date) TO service_role;

-- 5. Refund credits when generation fails after consumption.
CREATE OR REPLACE FUNCTION public.refund_image_credits(_user_id uuid, _count integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE new_used integer;
BEGIN
  UPDATE public.image_usage
    SET used = GREATEST(used - _count, 0), updated_at = now()
    WHERE user_id = _user_id
    RETURNING used INTO new_used;
  RETURN COALESCE(new_used, 0);
END;
$func$;

REVOKE ALL ON FUNCTION public.refund_image_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_image_credits(uuid, integer) TO service_role;