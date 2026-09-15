# Accessibility audit (C5)

WCAG 2.2 level AA, audited 2026-09-14 against a local production build
(`next build` + `next start`). Automated checks with axe-core 4.11, then the
things a program cannot decide checked by hand: keyboard order, focus return,
reduced motion, what a screen reader is given for charts.

## TL;DR

| | Before | After |
|---|---:|---:|
| Public pages (`/`, `/login`, `/register`, `/offline`), 3 variants | 36 violating nodes | **0** |
| 20 signed-in pages, light theme | 161 | **0** |
| 20 signed-in pages, dark theme | 268 | **3: 2 real, fixed; 1 artifact** (see note) |
| Charts with a text alternative | 0 of 17 | 16 of 16 in use (1 was dead code, deleted) |
| Icon-only controls without a name | 20+ | 0 found |
| Form controls without a label | ~45 | 0 found |
| Single-key shortcuts that could be turned off | no | yes (WCAG 2.1.4) |
| `prefers-reduced-motion` honoured | no | yes |

The final signed-in runs were paced (12 s between pages) so the API rate limit
never cut a page short; every page's failed API calls were recorded. Apart
from the Discover endpoints described below, no request failed.

Dark-theme note: of the 3 nodes left in the final dark run, two were real —
the monthly heatmap's strongest green cells, light text at 4.23:1 — and were
fixed by capping the tint at 40% (5.51:1). The third was an artifact of the
method: the audit switches the iframe to dark after it rendered, and an
off-screen, hidden document does not advance CSS transitions, so a breadcrumb
link with `transition-colors` was measured mid-transition in its light colour
(#536471 on black). With transitions disabled the same link measures #E7E9EA
on black.

axe finds roughly a third to a half of real WCAG failures. "0" means nothing a
program can decide is left, not that the app is accessible in every respect.

## How it was measured

### Public pages

```bash
npx next build && npx next start -p 3100
node scripts/a11y-audit.mjs http://localhost:3100 / /login /register /offline
```

Headless Chromium with `reducedMotion: 'reduce'`, three variants: desktop
light, desktop dark, phone light (390 px). Tags `wcag2a wcag2aa wcag21a
wcag21aa wcag22aa`. The dark variant stores `theme=dark` the way the theme
toggle does: the app's default theme is light whatever the OS says, so
`colorScheme: 'dark'` alone audits the light theme — the "before" public run
had exactly that problem, so its dark column was really light.

### Signed-in pages

The script holds no credentials. The 20 pages were audited in a browser that
was already signed in: each page loaded in an off-screen, same-origin iframe
5000 px tall (so contrast checks see the whole page), axe injected, results
collected. Dark mode by putting the `dark` class on that iframe's document,
which leaves the user's stored theme alone.

Pages: `/dashboard`, `/portfolio`, `/portfolio/[id]`, `…/transactions`,
`…/analytics`, `/market`, `/market/AAPL`, `/watchlist`, `/advisor`, `/lab`,
`/alerts`, `/discover`, `/discover/leaderboard`, `/settings`,
`/settings/profile`, `/settings/privacy`, `/compare`, `/market/compare`,
`/portfolio/new`, `/portfolio/import`.

## Findings and changes

Each finding lists the WCAG success criterion, what was measured, and what
changed.

### 1. Contrast — 1.4.3 (text), 1.4.11 (non-text)

Measured with the WCAG relative-luminance formula against the real surfaces
(`#FFFFFF`, `#F7F9FA`, and each colour's own 10–12% tint, where badges and
selected pills put it).

| Token (light) | Before | After |
|---|---|---|
| `--primary` | `#6366F1`: 4.47 on white, 4.23 on `#F7F9FA`, 4.40 on its tint | `#4F53E3`: 5.71 / 5.40 / 4.69 |
| `--gain`, `--good` | `#22C55E`: 2.28 | `#137333`: 5.95, 4.91 on its tint |
| `--loss`, `--bad`, `--destructive` | `#EF4444`: 3.76 | `#C81E1E`: 5.74, 4.61 on its tint |
| `--warn` | `#B45309`: 4.25 on its tint | `#A24A07`: 5.00 |

| Token (dark) | Before | After |
|---|---|---|
| `--muted-foreground` | `#71767B`: 3.87 on `#16181C` cards | `#8B9096`: 5.52 |

Chart series colours (`--chart-1…8`) were not changed: graphics need 3:1 and
the palette was already validated for that and for colour-vision deficiency.

Other contrast fixes:

- ~40 hard-coded `text-emerald-500`, `text-red-500`, `text-yellow-500`,
  `text-amber-500`, `text-orange-500`, `text-green-600` classes replaced by the
  `text-gain` / `text-loss` / `text-warn` / `text-destructive` tokens, which
  pass in both themes. Medal colours on the leaderboard got a darker light-mode
  step and a dark-mode variant.
- Alpha-faded text removed: `text-muted-foreground/60` (2.59:1) on sidebar
  section titles, `/50` and `/70` elsewhere, completed onboarding steps at
  `opacity-60`.
- Monthly returns heatmap: white text on 10–50% green/red tints measured
  1.54–2.07:1. Cells now use the foreground colour, and positive values carry
  a `+`, so the direction does not depend on colour (1.4.1).
- Links inside sentences on login/register were distinguishable only by colour
  (1.37:1 against the surrounding text): now underlined (1.4.1).
- Focus rings: components drew `ring-ring/50`, 2.07:1 against white. Now
  `ring-ring/80` (3.38:1 or more in both themes).

### 2. Names, roles and labels — 1.1.1, 1.3.1, 4.1.2, 2.5.3

- **Icon-only buttons named** (`aria-label`): open/close menu, theme toggle,
  account menu (announced as "G"), edit/delete per transaction ("Eliminar
  transacción de AAPL"), rename/delete watchlist, create watchlist, remove
  compared symbol, dismiss checklist, portfolio actions menu, back links.
- **Every Select named.** Base UI renders the trigger as `role=combobox`, whose
  name comes from a label, not from the value shown inside it — 22 triggers
  had none.
- **~45 labels associated** with their control (`htmlFor`/`id`): settings, new
  portfolio, compare, privacy, both transaction modals, the trade modal, the
  advisor's eight fields. Search boxes that had only a placeholder got a name.
- **Groups**: radio and checkbox groups in privacy settings are
  `role=radiogroup`/`group` named by their heading; trade type pills and the
  advisor's answer pills are toggle buttons with `aria-pressed` inside a named
  group; range sliders announce "7 de 10" and "35%".
- **Watchlist search** now follows the ARIA combobox pattern: the arrow keys
  already moved the highlight, and a screen reader now hears which result is
  highlighted (`aria-activedescendant`, `role=listbox/option`).
- **Tables**: header cells have `scope`, row headers are `th`, the empty
  actions column has a hidden "Acciones" header, sortable headers say the
  current order ("orden descendente"), the heatmap's one-letter month headers
  are read as the month name ("M" was March or May).
- **Status**: stale-price markers are `role=img` with Spanish text; error
  states are `role=alert`; the onboarding progress bar is a `progressbar`.
- The sidebar brand was a second `h1` on every page; now plain text.

### 3. Structural bugs — 4.1.2, 2.4.3

- **18 `<Link><Button>` nestings**: a button inside a link — invalid HTML and
  two tab stops for one control. Each is now a single `<Link>` with the button
  styles. `buttonVariants` moved to `button-variants.ts` so server components
  (the landing page) can use it: a function exported from a `"use client"`
  module cannot be called on the server.
- **3 `<DialogTrigger><Button>`**: a button inside a button. Now
  `render={<Button/>}`.

### 4. Keyboard — 2.1.1, 2.1.4, 2.4.1, 2.4.3, 2.4.11

- **Single-key shortcuts** (D, P, M, W, A, L, X, C, B, S, T) ignored modifiers:
  **Ctrl+C to copy opened /compare** and Ctrl+P opened /portfolio. They also
  fired inside open dialogs and typeahead widgets. One tested check
  (`src/lib/utils/keyboard-shortcuts.ts`) now guards all of them, and
  *Ajustes → Accesibilidad → Atajos de una tecla* turns them off, which 2.1.4
  requires.
- **Positions tables**: rows and mobile cards opened a symbol on click only.
  The symbol is now a link on desktop and the whole card a link on mobile.
- **Mobile drawer**: closed, the sidebar sat off-screen with its links still in
  the tab order — focus vanished into it. It is `inert` below `lg`, Escape
  closes it, and the current page's link has `aria-current="page"`.
- **Skip link** "Saltar al contenido" is the first tab stop, before the
  sidebar's eleven links; `main` receives focus.
- **Focus return**: the trade modal opens from buttons all over the app and
  from the T shortcut, so it had no trigger to return to; closing it left focus
  on `<body>`. It now returns focus to wherever it was.
- **Completed onboarding steps** were links to `#`: dead tab stops. Now list
  items marked "(completado)" for screen readers.

Verified by hand on the production build, signed in: first Tab lands on the
skip link; with the drawer closed Tab goes skip link → menu → search →
currency → theme → account menu → content, skipping the hidden sidebar;
Ctrl+C on the page no longer navigates; T opens the trade dialog with focus on
"Símbolo" and every field labelled; Escape closes it; every focused control
showed a visible ring or outline.

### 5. Charts — 1.1.1, 1.3.1

`src/components/charts/chart-figure.tsx` wraps every chart:

- the drawing is `aria-hidden` (an SVG of paths read aloud says nothing);
- a one-sentence summary, written from the data, is the figure's caption —
  e.g. "Proyección a 52 semanas con 1,000 trayectorias simuladas. Valor de hoy:
  … En la última semana, el escenario pesimista (P10) es …, la mediana … y el
  optimista … Es una simulación, no una predicción.";
- **"Ver datos como tabla"** opens the same data for everyone — screen-reader
  users, keyboard users who cannot hover a tooltip, anyone who wants exact
  numbers. Long series are sampled evenly to 60 rows, first and last kept,
  with a note saying so;
- Recharts' accessibility layer is off inside it and `<Pie>` gets
  `rootTabIndex={-1}`, so nothing focusable hides under `aria-hidden`.

Charts covered: portfolio value, allocation donut, portfolio vs benchmark,
drawdown, Monte Carlo, rolling risk, factor exposure, efficient frontier,
attribution waterfall, monthly income, price (and RSI), symbol comparison,
portfolio comparison (history and radar), advisor allocation and projection,
every lab experiment, and the strategy backtest curve. Where a chart already
had its numbers on screen (the donut's list, the attribution table) that text
is the alternative and the summary points to it. The 7-day sparklines carry a
hidden "Últimos 7 días: sube 2.10%".

Two things found while writing the summaries:

- the portfolio value summary read "un alza de 45084.03%" for an account funded
  from $10 — the value includes deposits, so a percentage of it reads as a
  return. Charts of such values leave the percentage out and say so;
- V8 parses "Semana 3" as 1 March 2001; the date formatter only treats ISO
  strings as dates (caught by a test).

### 6. Motion — 2.3.3, 2.2.2

Under `prefers-reduced-motion: reduce` (verified with Playwright on injected
elements):

| | No preference | Reduce |
|---|---|---|
| `animate-fade-in` | `fade-in 0.3s` | `1e-05s` — ends at once |
| Market ticker | `ticker-scroll 30s infinite` | `none` |
| Staggered cards | start at opacity 0 | opacity 1 |
| Spinners | `spin 1s infinite` | unchanged — the only sign something is loading |

Recharts 3.8 already follows the preference when `isAnimationActive` is left
at `'auto'`; the one chart forcing `true` no longer does. The lab's smooth
scroll respects the preference.

### 7. Found on the way, not an axe rule

- **The dashboard told users with money invested to "create your first
  portfolio" whenever loading their portfolios failed** — a rate-limit 429, a
  server error, or offline with nothing saved. Found because the audit's own
  requests tripped the API rate limiter. A failed load now shows an error with
  a retry, never the empty state.
- The benchmark overlay's tooltip said "SPY" whatever benchmark was compared.
- The audits themselves polluted C3's field data: every page they loaded from
  `localhost` reported its web vitals into the production `web_vitals` table
  (~230 rows in one hour). The reporter now skips local hosts, automated
  browsers and framed pages (`shouldReportVitals`, tested).
- `/api/discover/portfolios` and `/api/discover/leaderboard` return 500 on
  every load: route, hook and database function disagree on parameter names,
  sort values and response shape. Not an accessibility fix; left for its own
  task. `/discover`, `/discover/leaderboard` and the compare page's portfolio
  picker were therefore audited in their error/empty state. (Fixed 2026-09-15:
  contracts in `src/lib/services/discover.ts`; the populated states have not
  been re-audited.)
- Two unused components (`benchmark-chart.tsx`, `layout/header.tsx`, a stale
  copy of the top bar) were deleted rather than fixed.

## Limits

- **Screen readers were not run.** No NVDA, JAWS or VoiceOver session was
  available. What a screen reader receives was checked through the
  accessibility tree and axe, not heard.
- **Dialogs, menus and non-default tabs** are not loaded when a page first
  renders, so axe did not scan them. The trade dialog was checked by hand;
  other dialogs (alerts, compare, transaction edit) had their labels fixed in
  code but were not opened during the audit. Only the default analytics tab
  was scanned.
- **Rate limiting during the audit.** The API allows 60 requests per minute per
  IP; loading pages back to back exceeds it and early runs scanned some pages
  in their error state. The final runs were paced and recorded no 429.
- **/compare charts** were verified with one portfolio; comparison needs two.
- **Not changed here, for C9 (financial UX):** zero values are coloured as
  gains in `FormattedAmount` and `PercentageChange`; chart series colours and
  the advisor donut's green/red palette (D12).

## Re-running

```bash
npx next build && npx next start -p 3100
node scripts/a11y-audit.mjs http://localhost:3100
npm run test:run -- tests/lib/utils/keyboard-shortcuts.test.ts tests/lib/utils/chart-accessibility.test.ts
```
