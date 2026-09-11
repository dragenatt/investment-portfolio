-- ─────────────────────────────────────────────────────────────────────────────
-- 016 · factor_returns — the cached daily series for the factor model
--
-- Running a factor regression means six ETF price histories. Refetching those on
-- every request would spend six provider calls to answer a question whose inputs
-- change once a day, so the computed series is stored here instead.
--
-- What this table holds is a DERIVED series, not raw prices: each row is one
-- factor's long-minus-short return for one day, already differenced. The raw
-- prices it was built from live in price_history, unchanged, so a better factor
-- construction later can be recomputed from the same source without a backfill —
-- the same principle 011 and the price_history adjustment path already follow.
--
-- Reference data, not user data. Every authenticated user reads the same rows
-- and nobody writes them through the API; only the service role fills the table.
--
-- Purely additive. Nothing existing is dropped, altered or re-granted.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS factor_returns (
  -- Matches FACTOR_DEFINITIONS[].id in src/lib/services/factors.ts.
  factor_id TEXT NOT NULL,
  date DATE NOT NULL,
  -- Daily return of the factor as a decimal fraction, long minus short.
  -- Stored undifferenced from annualisation: the consumer decides.
  value DOUBLE PRECISION NOT NULL,
  -- Which construction produced this row. A change in how a factor is built
  -- must not silently mix with rows built the old way, so the version is part
  -- of the row rather than assumed.
  construction_version TEXT NOT NULL DEFAULT 'etf-proxy-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (factor_id, date, construction_version)
);

COMMENT ON TABLE factor_returns IS
  'Daily long-minus-short returns for each factor proxy. Derived from price_history; safe to truncate and rebuild.';

COMMENT ON COLUMN factor_returns.construction_version IS
  'Which factor construction produced the row. Part of the key so two constructions never blend into one series.';

-- Reads are always "one factor, a date range", which this index serves directly;
-- the primary key already leads with factor_id, so this covers the date-first
-- case of loading every factor for a window.
CREATE INDEX IF NOT EXISTS idx_factor_returns_date ON factor_returns (date DESC);

ALTER TABLE factor_returns ENABLE ROW LEVEL SECURITY;

-- Reference data: identical for everyone, derived entirely from public market
-- prices, and containing nothing about any user. Signed-in readers only, because
-- there is no reason for an anonymous visitor to pull decades of series.
DROP POLICY IF EXISTS "factor_returns_read" ON factor_returns;
CREATE POLICY "factor_returns_read" ON factor_returns
  FOR SELECT TO authenticated
  USING (true);

-- No INSERT, UPDATE or DELETE policy exists on purpose. With RLS enabled and no
-- write policy, every write through the API is denied; the service role bypasses
-- RLS and is the only thing that fills this table. That is the intended and only
-- write path, so adding a policy to express it would only widen the surface.

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Supabase grants every new table in `public` to anon and authenticated by
-- default. RLS already blocks both here — the only policy is SELECT TO
-- authenticated — but the grant should state the intent rather than lean on the
-- policy alone.
--
-- Safe to revoke, and specifically NOT the mistake 006a made: that revoked
-- EXECUTE on functions named inside RLS policies, which are evaluated with the
-- querying role's privileges. No policy anywhere references this table, nothing
-- writes it through the API, and the service role bypasses grants and RLS alike.
--
-- Verified after applying: authenticated SELECT true / INSERT false,
-- anon SELECT false, service_role INSERT true.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.factor_returns FROM anon, authenticated;
REVOKE SELECT ON TABLE public.factor_returns FROM anon;
GRANT SELECT ON TABLE public.factor_returns TO authenticated;
