-- ─────────────────────────────────────────────────────────────────────────────
-- 018 · current_prices — writes closed to users, changes streamed (C2)
--
-- Two changes, and the first is a security fix the second would have made worse.
--
-- 1. Anyone signed in could write any price.
--
--    001 created prices_insert and prices_update for the authenticated role with
--    WITH CHECK (true). current_prices is SHARED: the dashboard summary,
--    allocation, attribution and /api/market/[symbol] all read it as a price
--    source. With the anon key that ships in every browser bundle, any user could
--    PATCH /rest/v1/current_prices and set a price for everyone. The only writer
--    that relied on those policies was /api/rates, which now writes with the
--    service role, like price_history and factor_returns.
--
-- 2. Changes are published to Supabase Realtime.
--
--    Clients subscribe to the symbols they show instead of polling every 60
--    seconds. Realtime applies RLS to what it delivers: prices_select (every
--    authenticated user may read) is unchanged, anon receives nothing, and the
--    client narrows the stream to its own symbols with a filter. Publishing the
--    table while anyone could still write to it would have pushed a forged price
--    live to every screen watching that symbol — hence 1 first.
--
-- Nothing is dropped except the two write policies.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "prices_insert" ON current_prices;
DROP POLICY IF EXISTS "prices_update" ON current_prices;

REVOKE INSERT, UPDATE, DELETE ON current_prices FROM anon, authenticated;

-- Only the service role writes. With RLS on and no write policy, every write
-- through the API is denied; the service role bypasses RLS.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'current_prices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE current_prices;
  END IF;
END $$;
