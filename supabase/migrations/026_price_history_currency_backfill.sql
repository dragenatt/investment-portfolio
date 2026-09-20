-- ─────────────────────────────────────────────────────────────────────────────
-- 026 · Every stored close says what it is quoted in
--
-- Migration 021 added price_history.currency and every row written since
-- records it. The rows already in the table were left as they were: on
-- production, 2,089 of 4,090 are NULL — a little over half the history.
--
-- It works today by accident. Readers ask symbolCurrencies() for the unit,
-- which looks at the symbol's most recent non-null row and falls back to
-- current_prices, and every symbol happens to have at least one of those. Take
-- away the last three rows of AAPL and 132 closes become numbers with no unit,
-- which is how a peso ends up added to a dollar.
--
-- The unit is recoverable and unambiguous: every symbol with NULLs has exactly
-- one distinct currency among its own non-null rows, or a quote in
-- current_prices that says what it trades in. That is the same answer
-- symbolCurrencies() computes at read time — this writes it down.
--
-- Two passes, most specific first. Neither invents anything: a symbol that
-- cannot be resolved by either keeps its NULLs, and the notice at the end says
-- which ones and how many rows they are.
--
-- No NOT NULL constraint. The ingest path records NULL on purpose when a
-- provider does not state a currency (price-history.ts: "recorded as unknown
-- rather than guessed at 'USD', because a wrong currency is a silently wrong
-- conversion later"), and a constraint would make that lose the close
-- entirely. The root cause is closed on the write side instead: writeThrough
-- now fills in the symbol's known currency before storing a bar that arrived
-- without one.
-- ─────────────────────────────────────────────────────────────────────────────

-- Pass 1 — the symbol's own history, when it speaks with one voice.
WITH unambiguous AS (
  SELECT symbol, MIN(currency) AS currency
  FROM public.price_history
  WHERE currency IS NOT NULL
  GROUP BY symbol
  HAVING COUNT(DISTINCT currency) = 1
)
UPDATE public.price_history AS ph
SET currency = u.currency
FROM unambiguous AS u
WHERE ph.symbol = u.symbol
  AND ph.currency IS NULL;

-- Pass 2 — the quote table, for a symbol whose history says nothing at all.
WITH quoted AS (
  SELECT symbol, MIN(currency) AS currency
  FROM public.current_prices
  WHERE currency IS NOT NULL
  GROUP BY symbol
  HAVING COUNT(DISTINCT currency) = 1
)
UPDATE public.price_history AS ph
SET currency = q.currency
FROM quoted AS q
WHERE ph.symbol = q.symbol
  AND ph.currency IS NULL;

-- What could not be resolved, named rather than left to be discovered later.
DO $$
DECLARE
  remaining bigint;
  symbols text;
BEGIN
  SELECT COUNT(*), string_agg(DISTINCT symbol, ', ')
    INTO remaining, symbols
    FROM public.price_history
   WHERE currency IS NULL;

  IF remaining > 0 THEN
    RAISE NOTICE '026: % filas sin moneda, en: %', remaining, symbols;
  ELSE
    RAISE NOTICE '026: todas las filas de price_history tienen moneda';
  END IF;
END $$;
