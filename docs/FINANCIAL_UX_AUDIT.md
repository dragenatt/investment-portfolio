# Financial UX and accessibility audit (C9)

Audit of the components that show money, returns, risk and status — tables,
figures, gain/loss colours, charts, tooltips, empty states, loading and errors
— on 2026-09-14, against a production build. It builds on the WCAG audit in
`docs/ACCESSIBILITY_AUDIT.md` (C5), which already covered contrast, names,
keyboard and chart text alternatives.

The rule under test: **colour is never the only carrier** of gain, loss, risk
or status (WCAG 1.4.1), and **what a component says about the portfolio is
true** — including when data is missing, zero, or failed to load.

## Summary

| # | Finding | Where | Fixed |
|---|---|---|---|
| 1 | Zero shown as a gain: green, "+0.00%", ↑ | `PercentageChange`, `FormattedAmount`, `PriceDisplay`, KPI cards, P&L cards, market cards, watchlist, search chips, sectors, asset stats, symbol page | Yes |
| 2 | Values that round to zero printed "-0.00%" / "-$0.00" | same components | Yes |
| 3 | "++1.23%" in Top movers | `top-movers.tsx` | Yes |
| 4 | A failed load shown as a statement about the portfolio (0.00% returns, "Agrega transacciones", "Sin transacciones", "No tienes portafolios", "Crea uno primero") | analytics (8 panels), dashboard chart, transactions, portfolio detail, import, privacy | Yes |
| 5 | "Portafolio no encontrado" for any failure, not only a missing portfolio | portfolio detail | Yes |
| 6 | Transactions "Total" added fees to sales (overstating proceeds) and printed `$` for every currency | transactions table | Yes |
| 7 | Sales drawn red like losses (badge `destructive`) | transactions table | Yes |
| 8 | Stale vs unavailable price told apart by colour only (same icon) | dashboard positions | Yes |
| 9 | Financial help "?" opened on hover/focus only — nothing on a phone tap; 16 px target | `FinanceTooltip` | Yes |
| 10 | Loading skeletons silent for screen readers | `SkeletonChart`, `SkeletonCard`, `SkeletonTable` | Yes |
| 11 | Reviewed, already sound | see below | — |

## 1–3. Sign, colour and zero

**Before.** Components decided the colour with `value >= 0`: a day without
movement read "+0.00% ↑" in green; `-0.001` printed "-0.00%" in red; Top movers
prepended a "+" to `formatPercent`, which already signs, giving "++1.23%".

**After.** `src/lib/utils/change-tone.ts` decides one tone — gain, loss or flat
— on the value **rounded to the precision shown**, so the digits, the sign, the
arrow and the colour always agree:

| Value | Text | Colour | Arrow |
|---|---|---|---|
| 1.234 | +1.23% | gain | ↑ |
| -1.234 | -1.23% | loss | ↓ |
| 0 or ±0.004 | 0.00% (+ "sin cambio" for screen readers) | muted | none / "–" icon |

Every gain or loss keeps a non-colour signal: the sign always, plus an arrow or
trend icon where the design had one. Applied to the shared components
(`PercentageChange`, `FormattedAmount`, `PriceDisplay`, `formatPercent`) and to
every place that computed its own `isPositive`: KPI and P&L cards, market index
and mover cards, the symbol page header, position returns and analyst upside,
watchlist, public portfolio, sector performance, asset stats, returns summary,
top movers, symbol search and the trade autocomplete.

**Verified** on the dashboard: "Hoy: $0.00 USD (0.00%)" renders muted, no "+",
no arrow; no "++" or "-0.00" anywhere on the page.

## 4–5. Failed is not empty

**Before.** Financial components receive `data ?? 0` or `data ?? []`. When a
request failed — a rate-limit 429, a 500, offline with nothing saved — they
rendered those defaults as facts: the analytics overview showed **0.00% simple,
TWR and MWR returns**; the dashboard chart said "Agrega transacciones para ver
el rendimiento" to someone with transactions; transactions said there were
none; import said "Crea uno primero"; privacy said "No tienes portafolios";
the portfolio page said "Portafolio no encontrado" for any error. (C5 fixed the
same bug on the dashboard's portfolio list.)

**After.**

- `DataGate` (`src/components/shared/data-gate.tsx`): when a load failed and
  there is no earlier data, show the failure with a retry — "No se pudo cargar
  los rendimientos. Tus datos no se han perdido; vuelve a intentarlo." — as a
  `role="alert"`. Used on the eight analytics panels (returns, drawdown, risk,
  Monte Carlo, attribution, factors, frontier, income, allocation) and the
  dashboard chart.
- Transactions, import and privacy show their own error state.
- `apiFetcher` now throws `ApiError` carrying the HTTP status; `isNotFound()`
  lets the portfolio page keep "Portafolio no encontrado" for a real 404.

**Verified:** `/portfolio/<unknown uuid>` shows "Portafolio no encontrado";
tests cover `ApiError`/`isNotFound` for 404 vs 500.

## 6–7. The transactions ledger

**Before.** "Total" was `quantity × price + fees` for every row, shown with `$`.
For a sale that overstated what came in by twice the fee, and disagreed with the
position engine (`trade-history.ts`: sale proceeds = `quantity × price − fees`;
dividend = `quantity × price`). A EUR trade showed "$". Sales used the red
`destructive` badge.

**After.** `transactionCash()` (`src/lib/utils/transaction-display.ts`) follows
the engine, with a test that checks both produce the same cash flows. The table
shows price, fees and total in the transaction's own currency and says which
way the money went: "$1,005.00 USD pagado", "$995.00 USD recibido"; splits show
"—". Sales use the neutral badge; the label already names the type.

**Verified** on the real ledger: "$481.15 USD pagado", "$2,928.24 USD recibido";
"Venta" badge background `#F7F9FA` (neutral), "Compra" the primary colour.

## 8. Stale vs unavailable prices

Both were an amber/red triangle — the difference was colour alone. Now a clock
for a stale price and a crossed circle for an unavailable one, each with its
label (`role="img"` from C5).

## 9. Financial help

`FinanceTooltip` was a tooltip: hover and focus only, so tapping "?" on a phone
did nothing, and its target was 16 × 16 px. It is now a popover that opens on
hover, tap, click or Enter, with a 24 px hit area around the same 16 px circle
(WCAG 2.5.8) and a name that reads as a question: "Qué significa Retorno
Simple". **Verified:** clicking it opens the explanation, `aria-expanded="true"`.

## 10. Loading

Skeletons are grey blocks with nothing for assistive technology. They are now
`role="status"`, `aria-busy`, with hidden "Cargando gráfica…", "Cargando tabla…"
text; the blocks themselves are `aria-hidden`.

## 11. Reviewed and sound

- **Risk and signals** are words, not colours: "Riesgo {nivel}", "Comprar /
  Mantener / Vender", concentration alerts with distinct icons and text.
- **Comparisons** mark the best value with a trophy icon (named "Mejor valor"),
  not colour.
- **Heatmap** (C5): signed values, readable text, month names for screen readers.
- **Charts** (C5): each has a sentence and a data table; the portfolio value
  summary does not turn deposits into a return.
- **Tables:** numbers right-aligned in monospace; header cells scoped.
- **Dead code** removed: `dashboard/recent-activity.tsx` (unused, and it painted
  sales as losses).

## Not changed

- The advisor allocation donut's palette includes green and red for asset
  classes, which the app otherwise reserves for gain and loss — left for D12
  (visual identity), as noted in C3.
- Pages still using data hooks without an error branch where a failure reads as
  "no results" but says nothing about the user's money (market search, discover
  winners/losers, public profiles).

## Tests

`tests/lib/utils/change-tone.test.ts` (tones at display precision, signs,
words, `formatPercent`), `tests/lib/utils/transaction-display.test.ts` (ledger
amounts, agreement with `deriveTradeHistory`), component tests for flat zero in
`PercentageChange` and `FormattedAmount`, `ApiError` in `tests/lib/fetcher.test.ts`.
