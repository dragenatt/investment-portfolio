-- ─────────────────────────────────────────────────────────────────────────────
-- 023 · The costs a portfolio actually pays, as the user states them
--
-- costs.ts could take any return from gross to net — commission, spread,
-- custody, tax on gains — and nothing could tell it what a given portfolio
-- pays. The scenario engine used an all-zero model unless one request passed
-- two of the five figures by hand.
--
-- NULL means "not configured", and every return stays gross and says so.
-- There is deliberately no default: an invented "typical" commission would
-- turn every net figure in the app into fiction presented as a measurement.
--
-- Shape (validated by CostModelSchema in src/lib/schemas/portfolio.ts):
--   { commissionPct, commissionMin?, spreadPct, custodyAnnualPct,
--     capitalGainsTaxPct, source }
--
-- Additive. Existing portfolios keep NULL.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS cost_model JSONB;

COMMENT ON COLUMN portfolios.cost_model IS
  'User-stated costs (commission, spread, custody, capital-gains tax, source). NULL = not configured: returns are shown gross.';
