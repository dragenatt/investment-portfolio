-- ─────────────────────────────────────────────────────────────────────────────
-- 027 · auth.uid() once per query, and an index on every foreign key
--
-- Two findings from Supabase's own performance advisor, neither of which
-- changes what anybody is allowed to see.
--
-- 1. auth.uid() per row
--
-- A policy written `user_id = auth.uid()` makes Postgres call the function for
-- every row it tests, because a bare function call in a filter is re-evaluated
-- per row. Written `user_id = (select auth.uid())` it becomes a subquery the
-- planner evaluates once and reuses — an InitPlan. Same answer, same
-- authorisation, one call instead of N.
--
-- 33 policies across 17 tables are affected. Rather than write out 33 policy
-- definitions and risk a transcription error in one of them — a typo here is a
-- security hole, not a bug — this rewrites each policy from what is actually
-- stored, substituting only the function call. The logic cannot drift because
-- nothing re-states it.
--
-- It is idempotent: a policy already using the subquery form is skipped, so
-- running this twice does nothing the second time.
--
-- 2. Unindexed foreign keys
--
-- Four columns reference another table with no index of their own. Every
-- lookup by them is a sequential scan, and every delete of a parent row has to
-- scan the child table to check the constraint. The tables are small today,
-- which is exactly when this is cheap to fix.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  pol record;
  stmt text;
  rewritten int := 0;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (qual LIKE '%auth.uid()%' OR with_check LIKE '%auth.uid()%')
       -- Already an InitPlan; leave it alone.
       AND COALESCE(qual, '') NOT LIKE '%SELECT auth.uid()%'
       AND COALESCE(with_check, '') NOT LIKE '%SELECT auth.uid()%'
     ORDER BY tablename, policyname
  LOOP
    stmt := format('ALTER POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    -- USING and WITH CHECK are named only when the policy has them: Postgres
    -- refuses WITH CHECK on a SELECT or DELETE policy.
    IF pol.qual IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', replace(pol.qual, 'auth.uid()', '(select auth.uid())'));
    END IF;
    IF pol.with_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', replace(pol.with_check, 'auth.uid()', '(select auth.uid())'));
    END IF;

    EXECUTE stmt;
    rewritten := rewritten + 1;
  END LOOP;

  RAISE NOTICE '027: % politicas reescritas a (select auth.uid())', rewritten;
END $$;

-- The four foreign keys with no index behind them.
CREATE INDEX IF NOT EXISTS idx_analytics_jobs_portfolio_id ON public.analytics_jobs (portfolio_id);
CREATE INDEX IF NOT EXISTS idx_analytics_jobs_user_id ON public.analytics_jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_goal_projections_user_id ON public.goal_projections (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_portfolio_id ON public.notifications (portfolio_id);
