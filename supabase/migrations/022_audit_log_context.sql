-- ─────────────────────────────────────────────────────────────────────────────
-- 022 · Audit trail context: which portfolio, and a name a reader recognises
--
-- audit_log (migration 013) recorded entity_type and entity_id. For a position
-- or a transaction the id is a UUID, so the history could only say "changed
-- quantity on position 3f2a…", and it could not be filtered to one portfolio
-- because nothing in the row said which portfolio the entity belonged to.
--
--   portfolio_id — the portfolio the change happened in, when there is one.
--   Deliberately NOT a foreign key: ON DELETE SET NULL would rewrite trail rows,
--   and the table grants no UPDATE because a trail that changes is not a trail.
--
--   entity_label — what the reader calls the entity at the time of the change:
--   the symbol, the goal's name, "compra 10 AAPL". Stored, not joined, so a
--   later rename or deletion does not change what the history says happened.
--
-- Additive. Existing rows keep NULL in both.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS portfolio_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_label TEXT;

COMMENT ON COLUMN audit_log.portfolio_id IS
  'Portfolio the change happened in. Not a foreign key: trail rows are never rewritten.';
COMMENT ON COLUMN audit_log.entity_label IS
  'Human name of the entity at the time of the change (symbol, goal name, trade summary).';

CREATE INDEX IF NOT EXISTS idx_audit_log_user_portfolio_created
  ON audit_log (user_id, portfolio_id, created_at DESC);
