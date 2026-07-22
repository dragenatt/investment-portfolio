-- ─────────────────────────────────────────────────────────────────────────────
-- 011 · Daily price baselines (global "zero point" for daily P&L)
--
-- Problem: daily P&L was anchored to the nightly snapshot's total_value (or the
-- 2nd-to-last sparkline close), which depends on WHEN the snapshot ran / when the
-- user logged in. Result: the portfolio didn't reflect the market's intraday move.
--
-- Fix: store, once per trading day and shared across ALL users, the previous close
-- (regularMarketPreviousClose) — the standard "today's change" anchor — plus the
-- day's open for a future intraday variant. Daily P&L = qty × (live − previous_close).
--
-- This table IS the global once-a-day cache the requirement asks for: one row per
-- (symbol, date), filled by the /api/cron/baselines job (and lazily on first read),
-- so we never re-hit the market APIs per user.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_baselines (
  symbol         TEXT NOT NULL,
  date           DATE NOT NULL,            -- America/New_York trading day
  previous_close NUMERIC NOT NULL,         -- regularMarketPreviousClose (the zero point)
  open           NUMERIC,                  -- regularMarketOpen (reserved: intraday variant)
  currency       TEXT NOT NULL DEFAULT 'USD',
  source         TEXT NOT NULL DEFAULT 'market',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, date)
);

-- Fast "all baselines for today" lookups by the cron and reverse cleanup.
CREATE INDEX IF NOT EXISTS idx_daily_baselines_date ON daily_baselines(date DESC);

-- Baselines are shared reference data (like current_prices / price_history):
-- readable by any authenticated user, writable only by the service role.
ALTER TABLE daily_baselines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS baselines_select ON daily_baselines;
CREATE POLICY baselines_select ON daily_baselines
  FOR SELECT TO authenticated USING (true);
