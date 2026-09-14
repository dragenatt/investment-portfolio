-- ─────────────────────────────────────────────────────────────────────────────
-- 020 · Security hardening from the OWASP audit (C6, docs/SECURITY_AUDIT.md)
--
-- The anon key ships in the browser bundle, and any signed-in user holds a JWT.
-- Together they reach PostgREST directly, without going through a single API
-- route or its zod schema. So the boundary that counts is RLS plus privileges,
-- and every finding below was reachable that way.
--
-- NOT touched, on purpose (read 006a, 006b and 015 first):
-- auth_user_portfolio_ids, auth_user_position_ids, user_owns_portfolio and
-- user_has_portfolio_share are named in RLS policies and must stay executable by
-- the querying roles; revoking them broke every write once already.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. profiles: users cannot award themselves trust ────────────────────────
-- The UPDATE policy is `user_id = auth.uid()` with every column writable, so a
-- user could PATCH their own row to is_verified = true, add badges, or set
-- follower_count to a million. Column privileges keep the policy and narrow the
-- columns to what a person legitimately edits. Counters stay maintained by the
-- SECURITY DEFINER functions (toggle_follow) and triggers, which run as owner.
REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name, avatar_url, base_currency, theme, username, bio, location, website)
  ON public.profiles TO authenticated;
GRANT INSERT (user_id, display_name, avatar_url, base_currency, theme, username, bio, location, website)
  ON public.profiles TO authenticated;

-- ── 2. portfolios: no self-awarded likes or views ───────────────────────────
-- Same shape: an owner could set like_count / view_count on their own portfolio
-- (leaderboard and discovery manipulation) or overwrite share_token, and could
-- INSERT a portfolio born with 10,000 likes. deleted_at is set only through
-- soft_delete_portfolio(), which runs as owner.
REVOKE INSERT, UPDATE ON public.portfolios FROM anon, authenticated;
GRANT UPDATE (name, description, base_currency, benchmark_symbol, visibility,
              show_amounts, show_positions, show_transactions, show_allocation, tags)
  ON public.portfolios TO authenticated;
GRANT INSERT (user_id, name, description, base_currency, benchmark_symbol, visibility,
              show_amounts, show_positions, show_transactions, show_allocation, tags)
  ON public.portfolios TO authenticated;

-- ── 3. market_events: shared data, written by nobody signed in ──────────────
-- `market_events_auth_write` let any signed-in user insert, edit or delete the
-- earnings and dividend events every other user sees. The app only reads the
-- table (api/market/[symbol]/events); writes belong to the service role, which
-- bypasses RLS. Same class as current_prices in 018.
DROP POLICY IF EXISTS market_events_auth_write ON public.market_events;
REVOKE INSERT, UPDATE, DELETE ON public.market_events FROM anon, authenticated;

-- ── 4. Likes only on portfolios the caller can actually see ─────────────────
-- toggle_portfolio_like runs as owner and checked nothing about the target: any
-- user could like a private portfolio by id (moving its like_count) or like
-- their own. Now the target must be live, not the caller's, and public or
-- shared with the caller.
CREATE OR REPLACE FUNCTION public.toggle_portfolio_like(target_portfolio_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_liked BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = target_portfolio_id
      AND p.deleted_at IS NULL
      AND p.user_id <> auth.uid()
      AND (p.visibility = 'public' OR (p.visibility = 'shared' AND user_has_portfolio_share(p.id)))
  ) THEN
    RAISE EXCEPTION 'Portfolio not found';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM portfolio_likes WHERE user_id = auth.uid() AND portfolio_id = target_portfolio_id
  ) INTO is_liked;
  IF is_liked THEN
    DELETE FROM portfolio_likes WHERE user_id = auth.uid() AND portfolio_id = target_portfolio_id;
    UPDATE portfolios SET like_count = GREATEST(like_count - 1, 0) WHERE id = target_portfolio_id;
    RETURN false;
  ELSE
    INSERT INTO portfolio_likes (user_id, portfolio_id) VALUES (auth.uid(), target_portfolio_id);
    UPDATE portfolios SET like_count = like_count + 1 WHERE id = target_portfolio_id;
    RETURN true;
  END IF;
END;
$function$;

-- ── 5. Public portfolio RPCs honour the owner's privacy switches ────────────
-- Both functions run as owner and let anyone — anon included — read a public
-- portfolio's holdings by id. They ignored show_positions, show_amounts and
-- show_allocation: an owner who published returns but hid amounts still had
-- every symbol and dollar value readable at /rest/v1/rpc/get_portfolio_allocation.
-- The owner still sees everything; everyone else sees what the owner allowed.
CREATE OR REPLACE FUNCTION public.get_portfolio_allocation(portfolio_uuid uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result JSON;
  is_owner BOOLEAN;
  can_see_amounts BOOLEAN;
  can_see_positions BOOLEAN;
BEGIN
  SELECT p.user_id = auth.uid(),
         p.user_id = auth.uid() OR COALESCE(p.show_amounts, false),
         p.user_id = auth.uid() OR COALESCE(p.show_positions, false)
    INTO is_owner, can_see_amounts, can_see_positions
  FROM portfolios p
  WHERE p.id = portfolio_uuid
    AND p.deleted_at IS NULL
    AND (p.user_id = auth.uid() OR (p.visibility = 'public' AND COALESCE(p.show_allocation, false)));

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  WITH pos_values AS (
    SELECT symbol, asset_type, quantity * avg_cost AS value
    FROM positions
    WHERE portfolio_id = portfolio_uuid
      AND quantity > 0
      AND deleted_at IS NULL
  ),
  totals AS (
    SELECT COALESCE(SUM(value), 0) AS total FROM pos_values
  )
  SELECT json_build_object(
    'byType', (
      SELECT COALESCE(json_agg(json_build_object(
        'name', asset_type,
        'value', CASE WHEN can_see_amounts THEN ROUND(type_value::numeric, 2) END,
        'pct', CASE WHEN t.total > 0 THEN ROUND((type_value / t.total * 100)::numeric, 2) ELSE 0 END
      ) ORDER BY type_value DESC), '[]'::json)
      FROM (SELECT asset_type, SUM(value) AS type_value FROM pos_values GROUP BY asset_type) type_breakdown, totals t
    ),
    'bySymbol', CASE WHEN can_see_positions THEN (
      SELECT COALESCE(json_agg(json_build_object(
        'symbol', symbol,
        'assetType', asset_type,
        'value', CASE WHEN can_see_amounts THEN ROUND(value::numeric, 2) END,
        'pct', CASE WHEN t.total > 0 THEN ROUND((value / t.total * 100)::numeric, 2) ELSE 0 END
      ) ORDER BY value DESC), '[]'::json)
      FROM pos_values, totals t
    ) ELSE '[]'::json END,
    'total', CASE WHEN can_see_amounts THEN (SELECT ROUND(total::numeric, 2) FROM totals) END
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_portfolio_performance(portfolio_uuid uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result JSON;
  can_see_amounts BOOLEAN;
BEGIN
  SELECT p.user_id = auth.uid() OR COALESCE(p.show_amounts, false)
    INTO can_see_amounts
  FROM portfolios p
  WHERE p.id = portfolio_uuid
    AND p.deleted_at IS NULL
    AND (p.user_id = auth.uid() OR p.visibility = 'public');

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  WITH latest_snapshot AS (
    SELECT total_value, total_return_pct, dividend_income, snapshot_date
    FROM portfolio_snapshots
    WHERE portfolio_id = portfolio_uuid
    ORDER BY snapshot_date DESC
    LIMIT 1
  ),
  earliest_snapshot AS (
    SELECT total_value, snapshot_date
    FROM portfolio_snapshots
    WHERE portfolio_id = portfolio_uuid
    ORDER BY snapshot_date ASC
    LIMIT 1
  )
  SELECT json_build_object(
    'currentValue', CASE WHEN can_see_amounts THEN COALESCE((SELECT total_value FROM latest_snapshot), 0) END,
    'totalReturn', COALESCE((SELECT total_return_pct FROM latest_snapshot), 0),
    'returnPct', CASE
      WHEN (SELECT total_value FROM earliest_snapshot) > 0
      THEN ROUND(
        ((COALESCE((SELECT total_value FROM latest_snapshot), 0) -
          (SELECT total_value FROM earliest_snapshot)) /
         (SELECT total_value FROM earliest_snapshot) * 100)::numeric,
        2
      )
      ELSE 0
    END,
    'dividendIncome', CASE WHEN can_see_amounts THEN COALESCE((SELECT dividend_income FROM latest_snapshot), 0) END,
    'lastUpdated', (SELECT snapshot_date FROM latest_snapshot)
  ) INTO result;

  RETURN result;
END;
$function$;

-- ── 6. anon reads and writes no table directly ──────────────────────────────
-- Every table has RLS on, and no policy grants anon anything, so today these
-- privileges open nothing. They are the only thing between one mistaken policy
-- (several are declared without TO, which includes anon) and every visitor.
-- Signed-out pages query no table: the landing, login, register and offline
-- pages render without data, and web vitals are written by the service role.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
