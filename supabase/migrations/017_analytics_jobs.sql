-- ─────────────────────────────────────────────────────────────────────────────
-- 017 · analytics_jobs — background jobs for heavy calculations (C1)
--
-- Monte Carlo, backtesting, factor regressions, optimisation and stress tests
-- used to run inside the HTTP request. Each row here is one of those
-- calculations: the request records it, the work runs after the response, and
-- the browser polls GET /api/jobs/[job_id]/status for the result.
--
-- The lifecycle lives in src/lib/services/jobs.ts. The table enforces what can
-- be enforced without it: which states exist, that a finished job carries what
-- its state promises, and that every unfinished job has a deadline — the thing
-- that stops a job from sitting in `processing` forever.
--
-- Purely additive. Nothing existing is dropped, altered or re-granted.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analytics_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES portfolios (id) ON DELETE CASCADE,
  -- Matches JOB_KINDS in src/lib/services/jobs.ts.
  kind TEXT NOT NULL CHECK (kind IN ('monteCarlo', 'backtest', 'factors', 'optimization', 'stress')),
  -- Normalised parameters (normaliseJobParams), exactly what the key was built from.
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- sha256 of user, kind, portfolio and params: two requests for the same work
  -- find the same job instead of starting a second one.
  job_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'retrying', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 5),
  result JSONB,
  error TEXT,
  error_kind TEXT CHECK (error_kind IN ('timeout', 'exception')),
  -- When the running attempt must be finished, or when a retry becomes due.
  deadline_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  -- A completed job has its result and a completion time; a failed one says why.
  CONSTRAINT analytics_jobs_completed_has_result
    CHECK (status <> 'completed' OR (result IS NOT NULL AND completed_at IS NOT NULL)),
  CONSTRAINT analytics_jobs_failed_has_error
    CHECK (status <> 'failed' OR (error IS NOT NULL AND error_kind IS NOT NULL)),
  CONSTRAINT analytics_jobs_attempts_within_limit
    CHECK (attempts <= max_attempts)
);

COMMENT ON TABLE analytics_jobs IS
  'Background jobs for heavy analytics (C1). Lifecycle in src/lib/services/jobs.ts; written only by the service role.';

-- "The newest job for this piece of work" — every create request asks it.
CREATE INDEX IF NOT EXISTS idx_analytics_jobs_key_created
  ON analytics_jobs (job_key, created_at DESC);

-- The nightly sweep looks for unfinished jobs whose deadline has passed.
CREATE INDEX IF NOT EXISTS idx_analytics_jobs_unfinished_deadline
  ON analytics_jobs (deadline_at)
  WHERE status IN ('processing', 'retrying');

ALTER TABLE analytics_jobs ENABLE ROW LEVEL SECURITY;

-- A user reads their own jobs and nobody else's. Results contain portfolio
-- analytics, so this is the whole of the access rule.
DROP POLICY IF EXISTS "analytics_jobs_read_own" ON analytics_jobs;
CREATE POLICY "analytics_jobs_read_own" ON analytics_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- No INSERT, UPDATE or DELETE policy, on purpose. Creating a job and moving it
-- through its states is done by the server with the service role, after it has
-- authenticated the user; a client that could write rows could mark its own job
-- completed with any result it liked.
REVOKE INSERT, UPDATE, DELETE ON analytics_jobs FROM anon, authenticated;
REVOKE ALL ON analytics_jobs FROM anon;
GRANT SELECT ON analytics_jobs TO authenticated;
