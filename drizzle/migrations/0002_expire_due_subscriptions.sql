CREATE OR REPLACE FUNCTION public.expire_due_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE n integer;
BEGIN
  WITH last AS (
    SELECT pay.user_id, max(pay.updated_at) AS last_paid, min(pay.updated_at) AS first_paid
    FROM public.payments pay
    JOIN public.profiles pr ON pr.id = pay.user_id
    WHERE pay.status = 'paid' AND pr.plan IN ('pro','max') AND pr.subscription_end IS NULL
    GROUP BY pay.user_id
  )
  UPDATE public.profiles pr
     SET subscription_start = COALESCE(pr.subscription_start, l.first_paid),
         subscription_end = l.last_paid + interval '1 month',
         subscription_status = 'active'
    FROM last l
   WHERE pr.id = l.user_id;

  UPDATE public.profiles
     SET plan = 'free', subscription_status = 'expired', updated_at = now()
   WHERE plan IN ('pro','max') AND subscription_end IS NOT NULL AND subscription_end <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$f$;
REVOKE ALL ON FUNCTION public.expire_due_subscriptions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_subscriptions() TO service_role;