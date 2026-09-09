-- ─────────────────────────────────────────────────────────────────────────────
-- 013 · Configurable benchmark, audit trail, notification centre
--
-- Three unrelated-looking additions that share one theme: making the app able to
-- say WHY a number is what it is.
--
--   portfolios.benchmark_symbol — every portfolio was measured against SPY, a
--   dollar-denominated US large-cap fund, whoever owned it and in whatever
--   currency. Alpha, beta, tracking error and information ratio are all
--   statements about a comparison, and comparing a Mexican peso book to SPY is a
--   statement about the exchange rate as much as about the portfolio.
--
--   audit_log — what changed, when, and from what to what. Existing tables keep
--   only the current state, so "why did my cost basis move?" has no answer.
--
--   notifications — the alert tables that exist (alerts, portfolio_alerts) are
--   per-symbol price triggers and concentration warnings. Neither can carry
--   "your Monte Carlo finished" or "this provider is down", and both are read
--   by their own screens rather than a single inbox.
--
-- All three are additive. Nothing is dropped or rewritten.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Configurable benchmark ───────────────────────────────────────────────────

ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS benchmark_symbol TEXT NOT NULL DEFAULT 'SPY';

COMMENT ON COLUMN portfolios.benchmark_symbol IS
  'Symbol this portfolio is measured against for alpha, beta, tracking error and information ratio. Must exist in benchmark_prices.';

-- ── Audit trail ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- What kind of thing changed: 'position', 'transaction', 'portfolio', 'goal'.
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  -- What happened to it: 'created', 'updated', 'deleted', 'rebalanced'.
  action TEXT NOT NULL,
  -- Which field moved, when the action is an update.
  field TEXT,
  -- Values are stored as text rather than jsonb: the trail is for reading, and a
  -- schema change should never make an old entry unreadable.
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_created
  ON audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON audit_log (entity_type, entity_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Read-only to its owner. There is deliberately no UPDATE or DELETE policy: a
-- trail a user can edit is not a trail. Rows are written by the service role.
DROP POLICY IF EXISTS audit_log_select ON audit_log;
CREATE POLICY audit_log_select ON audit_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── Notification centre ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  portfolio_id UUID REFERENCES portfolios ON DELETE CASCADE,
  -- 'portfolio' | 'market' | 'data' | 'system'
  category TEXT NOT NULL,
  -- Narrower kind within the category, e.g. 'out_of_band', 'drawdown',
  -- 'stale_price', 'provider_down', 'montecarlo_done', 'backtest_done'.
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  body TEXT,
  -- Small structured payload for the UI to link somewhere useful.
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The inbox query is "my unread, newest first", so index for exactly that.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- One row per user per event kind per day, so a job that runs hourly cannot
-- deliver the same drawdown warning twenty-four times.
-- The day is anchored to UTC rather than written as created_at::date, because
-- casting timestamptz to date depends on the session TimeZone and is therefore
-- only STABLE; Postgres rejects it in an index expression.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications (
    user_id,
    kind,
    COALESCE(portfolio_id, '00000000-0000-0000-0000-000000000000'::uuid),
    (((created_at AT TIME ZONE 'UTC'))::date)
  );

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Marking read is the only change a user may make to their own notification.
DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_delete ON notifications;
CREATE POLICY notifications_delete ON notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
