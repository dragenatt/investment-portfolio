-- 007_analytics_overhaul.sql
-- Analytics Overhaul: new tables, fix missing columns, add metrics columns

-- ═══════════════════════════════════════════════════════════════════
-- FIX: Add missing columns referenced by migration 006 functions
-- ═══════════════════════════════════════════════════════════════════

-- positions.deleted_at (referenced in 006 RLS but never created)
ALTER TABLE positions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- current_prices.is_active (referenced in 006 indexes)
ALTER TABLE current_prices ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- price_history.is_active (referenced in 006 indexes)
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- ═══════════════════════════════════════════════════════════════════
-- NEW TABLE: cron_runs — job execution monitoring
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  portfolios_processed INTEGER DEFAULT 0,
  portfolios_failed INTEGER DEFAULT 0,
  error_details JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_date ON cron_runs(job_name, started_at DESC);

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON cron_runs FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════
-- NEW TABLE: benchmark_prices — daily benchmark index data
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS benchmark_prices (
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  close NUMERIC NOT NULL,
  change_pct NUMERIC,
  PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_date ON benchmark_prices(symbol, date DESC);

ALTER TABLE benchmark_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON benchmark_prices FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service write" ON benchmark_prices FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════
-- NEW TABLE: leaderboard_history — daily leaderboard snapshots
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS leaderboard_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  category TEXT NOT NULL,
  period TEXT NOT NULL,
  rankings JSONB NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (snapshot_date, category, period)
);

ALTER TABLE leaderboard_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON leaderboard_history FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service write" ON leaderboard_history FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════
-- NEW TABLE: portfolio_alerts — concentration risk alerts
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS portfolio_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  is_dismissed BOOLEAN DEFAULT false,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_portfolio_alerts_active
  ON portfolio_alerts(portfolio_id) WHERE NOT is_dismissed;

ALTER TABLE portfolio_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access" ON portfolio_alerts FOR ALL
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════
-- ALTER portfolio_snapshots: add new metric columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS twr NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS mwr NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS calmar_ratio NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS var_95 NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS tracking_error NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS information_ratio NUMERIC;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS dividend_income NUMERIC DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS dividend_income_mtd NUMERIC DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS dividend_income_ytd NUMERIC DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS dividend_income_total NUMERIC DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS portfolio_yield NUMERIC;

-- ═══════════════════════════════════════════════════════════════════
-- ALTER profiles: add badges column
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS badges JSONB DEFAULT '[]'::jsonb;

-- ═══════════════════════════════════════════════════════════════════
-- Refresh statistics
-- ═══════════════════════════════════════════════════════════════════

ANALYZE cron_runs;
ANALYZE benchmark_prices;
ANALYZE leaderboard_history;
ANALYZE portfolio_alerts;
ANALYZE portfolio_snapshots;
ANALYZE positions;
ANALYZE current_prices;
ANALYZE price_history;
