# Contributing to InvestTracker

Rules that are easy to break and expensive to find later. Most are enforced by a
test; the test is named next to each rule.

## Before a change is done

```bash
npm run test:run
npx tsc --noEmit
npm run build
```

All three pass, and the change has been looked at on a running build — a
screen that type-checks can still show the wrong number.

## Numbers

### Typography (D11)

**Toda cifra financiera renderizada debe utilizar `.font-financial`.**

Money, percentages, quantities, metrics, table cells, the risk dashboard, P&L.
`.font-financial` (defined in `src/app/globals.css`) is the monospace face with
tabular figures: every digit has the same width, so decimal points line up down
a column and a live price does not shift sideways when it ticks.

- `FormattedAmount` and `PercentageChange` apply it themselves.
- Identifiers — tickers, routes, codes — use plain `font-mono`, not
  `font-financial`: they are not figures.
- A number inside a sentence ("con 10,000 simulaciones") stays in the text face.
- Enforced by `tests/lint/financial-typography.test.ts`, which parses every
  component and fails on a formatted figure rendered outside `.font-financial`.

### Correctness

- Financial math lives in pure functions under `src/lib/services` or
  `src/lib/utils`, with tests. Components format; they do not calculate.
- No `NaN`, `Infinity`, probability outside 0–1 or weights not summing to 100%
  may reach the interface.
- Zero is neither a gain nor a loss; sign, colour and arrow come from the value
  rounded to the precision shown (`src/lib/utils/change-tone.ts`).
- A failed request is not an empty state: never render `data ?? []` as "you
  have nothing" (`docs/FINANCIAL_UX_AUDIT.md`).
- No hard-coded financial assumption without a documented source
  (`docs/FINANCIAL_ASSUMPTIONS.md`).

## Colour and design tokens

- Colours come from the tokens in `src/app/globals.css`. Gain and loss are
  `--gain`/`--loss` (`text-gain`, `text-loss`), never `text-green-*` or
  `text-red-*`; warnings are `--warn`.
- Colour never carries meaning alone: pair it with a sign, an arrow, or words.
- Categorical series use `--chart-1` … `--chart-8` in order; green and red are
  reserved for gain and loss (`src/lib/utils/chart-config.ts`).
- A new colour pair must reach WCAG AA (4.5:1 for text, 3:1 for graphics and
  focus rings) in light and dark mode, including on its own tinted background.

## Accessibility

- Every chart is wrapped in `ChartFigure` with a one-sentence summary and, when
  it plots data, a table (`src/components/charts/chart-figure.tsx`).
- Icon-only buttons and links have an accessible name; every form control has
  a label (`htmlFor`/`id`, or `aria-label` when there is no visible label).
- Links that look like buttons are a `<Link>` with `buttonVariants`, never a
  `<Button>` inside a `<Link>`.
- `scripts/a11y-audit.mjs` runs axe on the public pages; `docs/ACCESSIBILITY_AUDIT.md`
  describes the signed-in audit.

## Security

- RLS and Postgres privileges are the security boundary, not API routes: the
  anon key ships in the browser (`docs/SECURITY_AUDIT.md`).
- A cache key for data that depends on who asks includes the user id —
  `tests/lib/cache/cache-key-scope.test.ts`.
- Server code using the service-role client checks ownership itself.
- Secrets never enter the repository; `.env.local` stays untracked and
  `.env.local.example` documents every variable.

## Database

- Schema changes are numbered files in `supabase/migrations/`, applied to
  Supabase, and committed with the code that needs them.

## Commits

- One logical change per commit, with the reasoning in the message: what was
  wrong, what changed, how it was verified.
