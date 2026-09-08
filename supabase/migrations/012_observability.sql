-- ─────────────────────────────────────────────────────────────────────────────
-- 012 · Observability (funnel events + API error log)
--
-- Two append-only tables behind /admin/metrics, so the team can read the numbers
-- without depending on the Sentry or PostHog APIs (and without their tokens):
--
--   funnel_events — the key steps of the educational funnel. Carries NO personal
--   data by design: the internal Supabase user id and a small properties object
--   of primitives, never an email, a display name, a portfolio name or an amount.
--
--   error_events — one row per unhandled API error, written best-effort by
--   apiHandler. Feeds the "recent errors" tile. Note this counts errors, not a
--   true rate: there is no request counter to divide by, and adding a DB write
--   per successful request to get one would cost more than the number is worth.
--
-- Both tables are written and read with the service role only. RLS is enabled
-- with no policy attached on purpose: the service role bypasses RLS, and nothing
-- client-side should ever read another user's funnel.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS funnel_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "how many X in the last N days", the dashboard's only read pattern.
CREATE INDEX IF NOT EXISTS idx_funnel_events_event_date ON funnel_events(event, created_at DESC);

-- cuenta_creada and primera_simulacion_montecarlo are once-in-a-lifetime steps.
-- A partial unique index makes a repeat insert a no-op via ON CONFLICT DO NOTHING,
-- instead of a read-then-write that two concurrent requests could both pass.
CREATE UNIQUE INDEX IF NOT EXISTS idx_funnel_events_once_per_user
  ON funnel_events(user_id, event)
  WHERE event IN ('cuenta_creada', 'primera_simulacion_montecarlo');

ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS error_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route      TEXT NOT NULL,   -- pathname only, never the query string
  method     TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_events_created ON error_events(created_at DESC);

ALTER TABLE error_events ENABLE ROW LEVEL SECURITY;
