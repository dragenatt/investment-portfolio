-- ─────────────────────────────────────────────────────────────────────────────
-- 024 · Which snapshots are valued in one currency
--
-- Until this change the nightly snapshot summed units × quote (in whatever
-- currency each symbol trades) and units × average cost (in whatever currency
-- each position was recorded) as if both were the portfolio's currency. For a
-- book of dollar-quoted assets bought in pesos, total_value was the dollar sum,
-- total_cost the peso sum, and total_return_pct about -94%.
--
-- Those rows cannot be recomputed: a snapshot is the book at that night's
-- prices, and the prices it used were not stored. They are not deleted either
-- — that is the owner's call. They are quarantined instead:
--
--   valuation_version = 2  valued in the portfolio's base currency (book-valuation.ts)
--   NULL                   written before; not comparable, and readers skip it
--
-- Additive.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS valuation_version SMALLINT;

COMMENT ON COLUMN portfolio_snapshots.valuation_version IS
  '2 = value and cost converted into the portfolio base currency. NULL = written before 2026-09-19 with currencies mixed; readers skip it.';
