-- ─────────────────────────────────────────────────────────────────────────────
-- 019 · web_vitals — field Core Web Vitals from real browsers (C3)
--
-- The lab script can only measure public pages; signed-in pages are measured by
-- the browsers of the people using them. Each row is one metric from one page
-- view: which metric, its value, the route PATTERN (ids, symbols and usernames
-- collapsed before storage) and the rating the web-vitals library assigned.
--
-- No user id, no session, no IP. Nothing here identifies anyone.
--
-- Written only by the service role from POST /api/analytics/vitals; RLS on with
-- no policy, so nothing client-side reads or writes it directly. Purely
-- additive.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS web_vitals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL CHECK (name IN ('LCP', 'CLS', 'INP', 'FCP', 'TTFB')),
  value DOUBLE PRECISION NOT NULL CHECK (value >= 0),
  rating TEXT CHECK (rating IN ('good', 'needs-improvement', 'poor')),
  navigation_type TEXT,
  route TEXT NOT NULL CHECK (char_length(route) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE web_vitals IS
  'Field Core Web Vitals per route pattern (C3). Anonymous. Written only by the service role.';

-- The one read: p75 of a metric per route over a recent window.
CREATE INDEX IF NOT EXISTS idx_web_vitals_name_route_created
  ON web_vitals (name, route, created_at DESC);

ALTER TABLE web_vitals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_vitals FROM anon, authenticated;
