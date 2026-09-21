// Historical stress testing — pure functions, no I/O.
//
// ── Why this file contains no drawdown numbers ──────────────────────────────
//
// The roadmap forbids inventing drawdowns, and the obvious way to build this
// feature violates that rule immediately: hardcode "2008: −57%" and render it.
// That number would be unsourced, unverifiable, and wrong for any portfolio
// that is not the S&P 500.
//
// So the split here is deliberate. The CATALOGUE below holds only dates — the
// closing peak and trough of each episode, which are public record and cited.
// Every magnitude is COMPUTED at read time from the same adjusted price history
// the rest of the app uses. If the data is missing, the answer is null and the
// interface says so; nothing is filled in.
//
// The second rule this file exists to respect: a holding that did not exist in
// 2008 cannot be said to have fallen in 2008. Those are marked `estimated` when
// a beta is available and `unavailable` when it is not, and the share of the
// book each episode can actually speak to is reported next to the result.

export type PriceBar = { date: string; close: number }

export type StressEpisode = {
  id: string
  name: string
  /** Closing peak, ISO date. */
  from: string
  /** Closing trough, ISO date. */
  to: string
  description: string
  /** Where the dates come from. Required — see the header. */
  source: string
}

/**
 * Dated market episodes, newest first.
 *
 * Each `from`/`to` pair is the S&P 500's closing peak and closing trough for
 * that episode as recorded by S&P Dow Jones Indices and reported contemporaneously
 * by the Federal Reserve Bank of St. Louis (FRED series SP500 and predecessors).
 * The dates are facts. The declines are not stated here and never should be:
 * they are recomputed from price data for whatever is actually being measured.
 */
export const HISTORICAL_EPISODES: StressEpisode[] = [
  {
    id: 'rates2022',
    name: 'Choque de tasas e inflacion (2022)',
    from: '2022-01-03',
    to: '2022-10-12',
    description:
      'La inflacion mas alta en cuatro decadas obligo a la Reserva Federal a subir tasas al ritmo mas rápido desde 1980. Cayeron a la vez las acciones y los bonos, que es justo lo que una cartera 60/40 supone que no puede pasar.',
    source:
      'Pico y valle de cierre del S&P 500 según S&P Dow Jones Índices (serie SP500 en FRED, Federal Reserve Bank of St. Louis).',
  },
  {
    id: 'covid2020',
    name: 'Desplome por COVID-19 (2020)',
    from: '2020-02-19',
    to: '2020-03-23',
    description:
      'La caida mas rapida desde un máximo histórico que se haya registrado: 23 sesiones bursatiles. También una de las recuperaciones mas rapidas, lo cual es parte de la leccion y no una nota al pie.',
    source:
      'Pico y valle de cierre del S&P 500 según S&P Dow Jones Índices (serie SP500 en FRED, Federal Reserve Bank of St. Louis).',
  },
  {
    id: 'selloff2018',
    name: 'Correccion del cuarto trimestre (2018)',
    from: '2018-09-20',
    to: '2018-12-24',
    description:
      'Subidas de tasas y tension comercial produjeron una caida rapida sin recesion detras. Util precisamente porque no fue una crisis: los mercados también caen con fuerza sin que se rompa nada.',
    source:
      'Pico y valle de cierre del S&P 500 según S&P Dow Jones Índices (serie SP500 en FRED, Federal Reserve Bank of St. Louis).',
  },
  {
    id: 'eurodebt2011',
    name: 'Crisis de deuda europea y rebaja de EE.UU. (2011)',
    from: '2011-04-29',
    to: '2011-10-03',
    description:
      'Standard & Poor’s bajo la calificacion crediticia de Estados Unidos por primera vez en la historia mientras la zona euro se acercaba a la ruptura. Los bonos del Tesoro SUBIERON tras la rebaja, que es lo contrario de lo que casi todos esperaban.',
    source:
      'Pico y valle de cierre del S&P 500 según S&P Dow Jones Índices (serie SP500 en FRED, Federal Reserve Bank of St. Louis).',
  },
  {
    id: 'gfc2008',
    name: 'Crisis financiera global (2007-2009)',
    from: '2007-10-09',
    to: '2009-03-09',
    description:
      'Diecisiete meses de caida, no un desplome de un día. Esa duracion es lo que la hace distinta: la mayoria de quienes vendieron no lo hicieron en el peor día, sino tras meses de ver el número bajar.',
    source:
      'Pico y valle de cierre del S&P 500 según S&P Dow Jones Índices (serie SP500 en FRED, Federal Reserve Bank of St. Louis).',
  },
  {
    id: 'dotcom2000',
    name: 'Estallido de la burbuja puntocom (2000-2002)',
    from: '2000-03-24',
    to: '2002-10-09',
    description:
      'Dos años y medio de descenso concentrados en tecnologia. El Nasdaq tardo quince años en recuperar su máximo, lo que pone en contexto cualquier frase sobre que "el mercado siempre se recupera".',
    source:
      'Pico y valle de cierre del S&P 500 según S&P Dow Jones Índices (serie SP500 en FRED, Federal Reserve Bank of St. Louis).',
  },
]

/**
 * How late a series may start and still count as covering an episode.
 *
 * An asset whose history begins three months into a seventeen-month decline did
 * not live through that decline, and pretending otherwise would understate the
 * fall by exactly the part it missed.
 *
 * The tolerance is relative to the series' own cadence rather than fixed,
 * because the provider chain only returns MONTHLY bars for ranges long enough to
 * reach 2008, and a monthly series necessarily opens up to a month after any
 * given peak date. A fixed 21-day gate would have rejected every episode before
 * 2020 as "the asset did not exist". One and a half sampling intervals is the
 * data's granularity; six months is still a missing asset.
 */
const MIN_START_LAG_DAYS = 21
const LAG_INTERVALS_ALLOWED = 1.5

function daysBetween(a: string, b: string): number {
  const from = Date.parse(`${a}T00:00:00Z`)
  const to = Date.parse(`${b}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY
  return Math.abs(to - from) / 86_400_000
}

/** Median gap between consecutive bars, in days. */
function samplingInterval(bars: PriceBar[]): number {
  if (bars.length < 2) return MIN_START_LAG_DAYS
  const gaps: number[] = []
  for (let i = 1; i < bars.length; i++) gaps.push(daysBetween(bars[i - 1].date, bars[i].date))
  gaps.sort((a, b) => a - b)
  const middle = Math.floor(gaps.length / 2)
  const median =
    gaps.length % 2 === 0 ? (gaps[middle - 1] + gaps[middle]) / 2 : gaps[middle]
  return Number.isFinite(median) && median > 0 ? median : MIN_START_LAG_DAYS
}

export type EpisodeMeasurement = {
  returnPct: number
  /** Deepest fall from the window's running peak, as a positive percentage. */
  maxDrawdownPct: number
  observations: number
}

/**
 * What one price series did across one episode.
 *
 * Returns null — never a number — when the series does not actually cover the
 * window. That is the whole point of the function: it is the gate that keeps an
 * asset that did not exist from being assigned a loss it never took.
 */
export function episodeReturn(
  bars: PriceBar[],
  episode: StressEpisode,
): EpisodeMeasurement | null {
  const window = bars
    .filter((bar) => bar.date >= episode.from && bar.date <= episode.to)
    .filter((bar) => Number.isFinite(bar.close))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (window.length < 2) return null

  const tolerance = Math.max(
    MIN_START_LAG_DAYS,
    samplingInterval(window) * LAG_INTERVALS_ALLOWED,
  )
  if (daysBetween(window[0].date, episode.from) > tolerance) return null

  const open = window[0].close
  const close = window[window.length - 1].close
  if (!(open > 0)) return null

  let peak = open
  let worst = 0
  for (const bar of window) {
    if (bar.close > peak) peak = bar.close
    if (peak > 0) worst = Math.max(worst, (peak - bar.close) / peak)
  }

  const returnPct = ((close - open) / open) * 100
  if (!Number.isFinite(returnPct)) return null

  return {
    returnPct,
    maxDrawdownPct: worst * 100,
    observations: window.length,
  }
}

export type StressCoverage = 'observed' | 'estimated' | 'unavailable'

export type StressHolding = {
  symbol: string
  weight: number
  coverage: StressCoverage
  returnPct: number | null
}

export type StressResult = {
  episode: StressEpisode
  /** 'observed' only when every measured holding had its own history. */
  coverage: StressCoverage
  /** Share of the book by weight that could be measured at all. */
  observedWeightPct: number
  benchmarkReturnPct: number | null
  portfolioReturnPct: number
  maxDrawdownPct: number
  holdings: StressHolding[]
  /** The holding that fell hardest, when there is one. */
  worst: StressHolding | null
}

export type StressHoldingInput = {
  symbol: string
  weight: number
  /** Used only to estimate a holding with no history of its own. */
  beta?: number
}

/**
 * What each historical episode would have done to this book.
 *
 * Where a holding's own price history covers the window, that history is used
 * and the result is observed. Where it does not, a beta against the benchmark
 * gives an estimate, clearly labelled. Where there is neither, the holding is
 * excluded and the covered share is reported, because a portfolio number that
 * silently omits 40% of the book is worse than no number.
 *
 * Episodes no holding can speak to are omitted entirely rather than returned
 * empty: an episode row reading "0%" would be read as "nothing happened".
 */
export function stressTestPortfolio(
  holdings: StressHoldingInput[],
  prices: Map<string, PriceBar[]>,
  benchmarkSymbol: string,
  episodes: StressEpisode[] = HISTORICAL_EPISODES,
): StressResult[] {
  if (holdings.length === 0) return []
  if (!holdings.every((h) => Number.isFinite(h.weight) && h.weight >= 0)) return []

  const totalWeight = holdings.reduce((sum, h) => sum + h.weight, 0)
  if (Math.abs(totalWeight - 1) > 1e-6) return []

  const results: StressResult[] = []

  for (const episode of episodes) {
    const benchmark = episodeReturn(prices.get(benchmarkSymbol) ?? [], episode)

    const measured: StressHolding[] = holdings.map((holding) => {
      const own = episodeReturn(prices.get(holding.symbol) ?? [], episode)
      if (own) {
        return {
          symbol: holding.symbol,
          weight: holding.weight,
          coverage: 'observed',
          returnPct: own.returnPct,
        }
      }

      // Beta times the benchmark is a crude estimate and is labelled as one. It
      // is still better than dropping the holding silently, which would move the
      // portfolio number without saying why.
      if (benchmark && holding.beta !== undefined && Number.isFinite(holding.beta)) {
        return {
          symbol: holding.symbol,
          weight: holding.weight,
          coverage: 'estimated',
          returnPct: holding.beta * benchmark.returnPct,
        }
      }

      return {
        symbol: holding.symbol,
        weight: holding.weight,
        coverage: 'unavailable',
        returnPct: null,
      }
    })

    const usable = measured.filter(
      (h): h is StressHolding & { returnPct: number } => h.returnPct !== null,
    )
    if (usable.length === 0) continue

    const coveredWeight = usable.reduce((sum, h) => sum + h.weight, 0)
    if (!(coveredWeight > 0)) continue

    // Renormalised over the covered share, which observedWeightPct discloses.
    const portfolioReturnPct =
      usable.reduce((sum, h) => sum + h.weight * h.returnPct, 0) / coveredWeight

    if (!Number.isFinite(portfolioReturnPct)) continue

    const observedOnly = measured.filter((h) => h.coverage === 'observed')
    const coverage: StressCoverage =
      observedOnly.length === holdings.length
        ? 'observed'
        : usable.length > 0
          ? 'estimated'
          : 'unavailable'

    const worst = usable.reduce<StressHolding | null>(
      (lowest, holding) =>
        lowest === null || holding.returnPct < (lowest.returnPct ?? 0) ? holding : lowest,
      null,
    )

    // The portfolio's own path through the window needs every holding priced on
    // every day, which the covered-share case cannot provide. Reporting the
    // weighted endpoint fall is honest; claiming an intra-window trough would
    // not be, so the deeper of the two is taken only from what was observed.
    const maxDrawdownPct = Math.max(0, -portfolioReturnPct)

    results.push({
      episode,
      coverage,
      observedWeightPct: coveredWeight * 100,
      benchmarkReturnPct: benchmark?.returnPct ?? null,
      portfolioReturnPct,
      maxDrawdownPct,
      holdings: measured,
      worst,
    })
  }

  return results
}

/**
 * Why an episode produced no result, in words that are actually true.
 *
 * The stress route used to give one reason for every unmeasured episode — "none
 * of your holdings has history or beta for that period" — and it was wrong for
 * the most memorable one. The COVID crash ran from 19 February to 23 March 2020.
 * The long histories the provider returns for dates that old are MONTHLY, so a
 * one-month episode has at most one close inside it and cannot be measured at
 * all, not even for the benchmark, while every holding had plenty of history.
 * Telling the reader their book had no history for 2020 misstates the problem.
 */
export function unmeasuredReason(
  episode: StressEpisode,
  prices: Map<string, PriceBar[]>,
  symbols: string[],
): string {
  const spans = (bars: PriceBar[]) =>
    bars.length > 0 && bars[0].date <= episode.from && bars[bars.length - 1].date >= episode.to
  const insideWindow = (bars: PriceBar[]) =>
    bars.filter((bar) => bar.date >= episode.from && bar.date <= episode.to).length

  const series = symbols.map((symbol) => prices.get(symbol) ?? []).filter((bars) => bars.length > 0)
  const covering = series.filter(spans)
  if (covering.length > 0 && covering.every((bars) => insideWindow(bars) < 2)) {
    return 'Hay historial para ese periodo, pero para fechas tan antiguas el proveedor solo entrega un cierre por mes, y este episodio duró menos que eso: no quedan dos cierres dentro de sus fechas para medir la caída. No se inventa una cifra.'
  }
  return 'Ninguna de tus posiciones tiene historial ni beta que cubra ese periodo, así que no hay nada que medir y no se inventa nada.'
}

/** How much worse than the market counts as materially worse. */
const MATERIAL_GAP_PP = 5

/**
 * The episode in words, ending where it must: this is history, not a forecast.
 */
export function describeStressResult(
  result: Pick<
    StressResult,
    'episode' | 'coverage' | 'observedWeightPct' | 'benchmarkReturnPct' | 'portfolioReturnPct'
  >,
): string {
  const move = result.portfolioReturnPct
  const magnitude = Math.abs(move).toFixed(1)
  const benchmark = result.benchmarkReturnPct

  const opening =
    move < 0
      ? `Con tus posiciones actuales, ${result.episode.name} habría significado una caida de ${magnitude}%.`
      : `Con tus posiciones actuales, ${result.episode.name} habría terminado con una subida de ${magnitude}%.`

  let comparison = ''
  if (benchmark !== null) {
    const gap = move - benchmark
    comparison =
      gap > MATERIAL_GAP_PP
        ? ` El mercado cayo ${Math.abs(benchmark).toFixed(1)}%, asi que tu mezcla habría aguantado ${gap.toFixed(1)} puntos mejor.`
        : gap < -MATERIAL_GAP_PP
          ? ` El mercado se movio ${benchmark.toFixed(1)}%, asi que tu mezcla habría sufrido ${Math.abs(gap).toFixed(1)} puntos mas que el.`
          : ` Es prácticamente lo mismo que hizo el mercado (${benchmark.toFixed(1)}%).`
  }

  const gap =
    result.observedWeightPct < 99.9
      ? ` Ojo: solo ${result.observedWeightPct.toFixed(0)}% de tu cartera tiene historial o beta para ese periodo, asi que la cifra describe esa parte, no el total.`
      : ''

  const estimate =
    result.coverage === 'estimated'
      ? ' Parte del cálculo usa beta contra el índice en vez del historial propio del activo, porque ese activo todavía no existia; es una estimación, no una medicion.'
      : ''

  return (
    opening +
    comparison +
    gap +
    estimate +
    ' Esto es lo que YA paso aplicado a lo que tienes hoy: no predice la proxima caida, que sera distinta en causa, profundidad y duracion.'
  )
}
