-- supabase/migrations/001_initial_schema.sql

-- Profiles
CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  base_currency TEXT NOT NULL DEFAULT 'MXN',
  theme TEXT NOT NULL DEFAULT 'light',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Portfolios
CREATE TABLE portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  base_currency TEXT NOT NULL DEFAULT 'MXN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Positions
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('stock','etf','crypto','bond','forex','commodity')),
  quantity NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, symbol)
);

CREATE INDEX idx_positions_portfolio_id ON positions(portfolio_id);

-- Transactions
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID NOT NULL REFERENCES positions ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('buy','sell','dividend','split')),
  quantity NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  fees NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_position_id ON transactions(position_id);

-- Watchlists
CREATE TABLE watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE watchlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id UUID NOT NULL REFERENCES watchlists ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_watchlist_items_watchlist_id ON watchlist_items(watchlist_id);

-- Alerts
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('above','below','pct_change_daily')),
  target_value NUMERIC NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_user_id ON alerts(user_id);
CREATE INDEX idx_alerts_symbol ON alerts(symbol, is_active);

-- Current prices (shared)
CREATE TABLE current_prices (
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'US',
  price NUMERIC NOT NULL,
  change_pct NUMERIC,
  volume BIGINT,
  currency TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (symbol, exchange)
);

-- Price history (shared)
CREATE TABLE price_history (
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'US',
  date DATE NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC NOT NULL,
  volume BIGINT,
  PRIMARY KEY (symbol, exchange, date)
);

-- Failed fetches (worker debugging)
CREATE TABLE failed_fetches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 1,
  last_attempt TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved BOOLEAN NOT NULL DEFAULT false
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE current_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_fetches ENABLE ROW LEVEL SECURITY;

-- Profiles: users see only their own
CREATE POLICY profiles_select ON profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (user_id = auth.uid());

-- Portfolios: users see only their own (excluding soft-deleted)
CREATE POLICY portfolios_select ON portfolios FOR SELECT USING (user_id = auth.uid() AND deleted_at IS NULL);
CREATE POLICY portfolios_insert ON portfolios FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY portfolios_update ON portfolios FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY portfolios_delete ON portfolios FOR DELETE USING (user_id = auth.uid());

-- Positions: through portfolio ownership
CREATE POLICY positions_select ON positions FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY positions_insert ON positions FOR INSERT
  WITH CHECK (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY positions_update ON positions FOR UPDATE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY positions_delete ON positions FOR DELETE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

-- Transactions: through position → portfolio ownership
CREATE POLICY transactions_select ON transactions FOR SELECT
  USING (position_id IN (
    SELECT p.id FROM positions p
    JOIN portfolios pf ON p.portfolio_id = pf.id
    WHERE pf.user_id = auth.uid()
  ));
CREATE POLICY transactions_insert ON transactions FOR INSERT
  WITH CHECK (position_id IN (
    SELECT p.id FROM positions p
    JOIN portfolios pf ON p.portfolio_id = pf.id
    WHERE pf.user_id = auth.uid()
  ));
CREATE POLICY transactions_delete ON transactions FOR DELETE
  USING (position_id IN (
    SELECT p.id FROM positions p
    JOIN portfolios pf ON p.portfolio_id = pf.id
    WHERE pf.user_id = auth.uid()
  ));

-- Watchlists
CREATE POLICY watchlists_all ON watchlists FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY watchlist_items_all ON watchlist_items FOR ALL
  USING (watchlist_id IN (SELECT id FROM watchlists WHERE user_id = auth.uid()))
  WITH CHECK (watchlist_id IN (SELECT id FROM watchlists WHERE user_id = auth.uid()));

-- Alerts
CREATE POLICY alerts_all ON alerts FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Price tables: read-only for authenticated, write for service_role
CREATE POLICY prices_select ON current_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY history_select ON price_history FOR SELECT TO authenticated USING (true);
CREATE POLICY failed_fetches_service ON failed_fetches FOR ALL TO service_role USING (true);
