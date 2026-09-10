-- ─────────────────────────────────────────────────────────────────────────────
-- 014 · Financial goals, with versioned projections
--
-- The advisor can already answer "will I get there?", but the answer evaporates
-- the moment the page is closed. A goal someone can come back to is what turns
-- a calculator into a plan.
--
-- Two tables rather than one, and the reason matters. `goals` holds the plan as
-- it stands and is updated in place. `goal_projections` holds every answer the
-- model has ever given about that plan, append-only, each row carrying the model
-- version and the assumptions that produced it.
--
-- Overwriting a projection would destroy the most educational thing here: seeing
-- that last year's model said 62% and this year's says 71%, and being able to
-- tell whether that moved because the plan changed, because the market did, or
-- because the model itself was corrected. A single mutable row cannot answer
-- that question, and roadmap P0-28 forbids the silent overwrite outright.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- Optional: a goal can be tracked against a real book, or stay hypothetical.
  portfolio_id UUID REFERENCES portfolios ON DELETE SET NULL,

  name TEXT NOT NULL,
  description TEXT,

  target_amount NUMERIC NOT NULL CHECK (target_amount > 0),
  currency TEXT NOT NULL DEFAULT 'MXN',
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  target_date DATE NOT NULL,

  starting_capital NUMERIC NOT NULL DEFAULT 0 CHECK (starting_capital >= 0),
  monthly_contribution NUMERIC NOT NULL DEFAULT 0 CHECK (monthly_contribution >= 0),

  -- The profile and assumptions the plan was built on, so a projection can be
  -- reproduced without guessing which risk level was selected at the time.
  risk_profile TEXT CHECK (risk_profile IN ('Conservador','Moderado','Agresivo')),
  expected_annual_return NUMERIC,
  expected_annual_volatility NUMERIC,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','reached','paused','cancelled')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT goals_dates_ordered CHECK (target_date > start_date)
);

CREATE INDEX IF NOT EXISTS idx_goals_user_status
  ON goals (user_id, status, target_date);

CREATE INDEX IF NOT EXISTS idx_goals_portfolio
  ON goals (portfolio_id)
  WHERE portfolio_id IS NOT NULL;

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS goals_select ON goals;
CREATE POLICY goals_select ON goals
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS goals_insert ON goals;
CREATE POLICY goals_insert ON goals
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS goals_update ON goals;
CREATE POLICY goals_update ON goals
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS goals_delete ON goals;
CREATE POLICY goals_delete ON goals
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── Projections ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS goal_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,

  -- Which engine produced this, so a number can always be traced to the code
  -- that made it. See docs/ADVISOR_MODEL_VERSIONING.md.
  model_version TEXT NOT NULL,
  seed BIGINT,
  simulations INTEGER,

  -- The inputs as they stood when this projection was taken. Duplicated from
  -- `goals` on purpose: the goal is mutable and this row must stay readable
  -- after it changes.
  target_amount NUMERIC NOT NULL,
  starting_capital NUMERIC NOT NULL,
  monthly_contribution NUMERIC NOT NULL,
  horizon_months INTEGER NOT NULL,
  expected_annual_return NUMERIC,
  expected_annual_volatility NUMERIC,

  -- The answer.
  probability_pct NUMERIC CHECK (probability_pct IS NULL OR (probability_pct >= 0 AND probability_pct <= 100)),
  deterministic_final NUMERIC,
  p10_final NUMERIC,
  p50_final NUMERIC,
  p90_final NUMERIC,
  required_contribution NUMERIC,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goal_projections_goal
  ON goal_projections (goal_id, created_at DESC);

ALTER TABLE goal_projections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS goal_projections_select ON goal_projections;
CREATE POLICY goal_projections_select ON goal_projections
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS goal_projections_insert ON goal_projections;
CREATE POLICY goal_projections_insert ON goal_projections
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- No UPDATE and no DELETE policy, deliberately. A projection is a record of what
-- the model said on a date; editing one would make the history a fiction, and
-- the history is the point.
