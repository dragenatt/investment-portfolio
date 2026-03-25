-- Company fundamentals cache
CREATE TABLE IF NOT EXISTS company_data (
  symbol TEXT PRIMARY KEY,
  rp_entity_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  sector TEXT,
  industry TEXT,
  market_cap BIGINT,
  pe_ratio NUMERIC,
  eps NUMERIC,
  dividend_yield NUMERIC,
  week52_high NUMERIC,
  week52_low NUMERIC,
  employees INTEGER,
  ceo TEXT,
  hq TEXT,
  website TEXT,
  competitors JSONB DEFAULT '[]',
  analyst_rating TEXT,
  analyst_target_price NUMERIC,
  revenue_ttm BIGINT,
  net_income_ttm BIGINT,
  raw_data JSONB DEFAULT '{}',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Market events cache (earnings, dividends, etc.)
CREATE TABLE IF NOT EXISTS market_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('earnings', 'dividend', 'split', 'conference')),
  event_date DATE NOT NULL,
  title TEXT,
  description TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '6 hours'),
  UNIQUE(symbol, event_type, event_date)
);

CREATE INDEX idx_market_events_symbol ON market_events(symbol);
CREATE INDEX idx_market_events_date ON market_events(event_date);
CREATE INDEX idx_company_data_expires ON company_data(expires_at);

-- RLS: read for authenticated users
ALTER TABLE company_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_data_read" ON company_data FOR SELECT TO authenticated USING (true);

ALTER TABLE market_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_events_read" ON market_events FOR SELECT TO authenticated USING (true);
