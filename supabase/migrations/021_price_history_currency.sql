-- 021 — the currency a stored close is quoted in.
--
-- price_history held (symbol, exchange, date, ohlc, volume) and nothing about
-- units, so every reader that summed across holdings was adding dollars to
-- pesos to reais to yen. The portfolio value chart did exactly that and then
-- sat next to a header already converted to the book's base currency: the same
-- quantity, on one screen, a factor of seventeen apart.
--
-- Nullable on purpose. Rows written before this migration genuinely do not know
-- their currency, and a default of 'USD' would invent the fact rather than
-- record it — most of them ARE dollars, but "most" is not a basis for a
-- conversion. Readers resolve a missing value from current_prices.currency or
-- from the provider, and say so when they cannot.

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS currency text;

COMMENT ON COLUMN price_history.currency IS
  'ISO 4217 code the close is quoted in, as reported by the provider. NULL for rows stored before migration 021; resolve from current_prices.currency or the provider quote.';

-- Resolving a symbol's currency means "the most recent non-null row for it".
CREATE INDEX IF NOT EXISTS idx_price_history_currency_lookup
  ON price_history (symbol, date DESC)
  WHERE currency IS NOT NULL;
