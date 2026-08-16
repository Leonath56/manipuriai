
-- 1. Hardening daily_usage RLS
ALTER TABLE public.daily_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own usage" ON public.daily_usage;
CREATE POLICY "Users read own usage" ON public.daily_usage FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own usage" ON public.daily_usage;
CREATE POLICY "Users update own usage" ON public.daily_usage FOR UPDATE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own usage" ON public.daily_usage;
CREATE POLICY "Users insert own usage" ON public.daily_usage FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage all usage" ON public.daily_usage;
CREATE POLICY "Admins manage all usage" ON public.daily_usage FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 2. Hardening user_memory RLS
ALTER TABLE public.user_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own memory" ON public.user_memory;
CREATE POLICY "Users manage own memory" ON public.user_memory FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all memory" ON public.user_memory;
CREATE POLICY "Admins view all memory" ON public.user_memory FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 3. Hardening payments RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see their own payments" ON public.payments;
CREATE POLICY "Users see their own payments" ON public.payments FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert their own payments" ON public.payments;
CREATE POLICY "Users insert their own payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update their own payments" ON public.payments;
CREATE POLICY "Users update their own payments" ON public.payments FOR UPDATE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage all payments" ON public.payments;
CREATE POLICY "Admins manage all payments" ON public.payments FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 4. Audit GRANTS (Ensure completeness)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_usage TO authenticated;
GRANT ALL ON public.daily_usage TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_memory TO authenticated;
GRANT ALL ON public.user_memory TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
