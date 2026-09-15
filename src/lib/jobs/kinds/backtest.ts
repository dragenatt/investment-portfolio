import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAdjustedPriceHistory, type PriceRow } from '@/lib/services/price-history'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import { buildResultMetadata, COMMON_ASSUMPTIONS } from '@/lib/services/result-metadata'
import {
  backtestPortfolio,
  type Bar,
  type RebalanceFrequency,
} from '@/lib/services/backtest'

const SCHEDULES: RebalanceFrequency[] = ['none', 'monthly', 'quarterly', 'semiannual', 'annual']

/**
 * Run the current book back through history under every rebalancing schedule.
 *
 * All five are returned rather than a single "best" one. Which schedule wins
 * depends entirely on the period tested — rebalancing helps in a mean-reverting
 * market and hurts in a trending one — so naming a winner would be reporting an
 * accident of the sample as a recommendation.
 */
export async function computeBacktest(supabase: SupabaseClient, pid: string, params: { costPct: number }) {
  const { costPct } = params
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('currency:base_currency')
    .eq('id', pid)
    .single()

  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, quantity, avg_cost')
    .eq('portfolio_id', pid)
    .gt('quantity', 0)

  if (!positions || positions.length === 0) return { message: 'No positions' }

  const symbols = positions.map((p) => p.symbol)
  const { rows, covered, missing, source: priceSource } = await fetchAdjustedPriceHistory(supabase, symbols)
  if (covered.length === 0) return { message: 'No price history for these holdings' }

  const seriesBySymbol: Record<string, Bar[]> = {}
  for (const row of rows as PriceRow[]) {
    if (!seriesBySymbol[row.symbol]) seriesBySymbol[row.symbol] = []
    seriesBySymbol[row.symbol].push({ date: row.date, close: row.close })
  }

  // Weights come from the book as it stands, valued at the latest close each
  // covered holding has.
  const latestValue: Record<string, number> = {}
  let bookValue = 0
  for (const symbol of covered) {
    const series = seriesBySymbol[symbol]
    const position = positions.find((p) => p.symbol === symbol)
    const value = (position?.quantity ?? 0) * (series[series.length - 1]?.close ?? 0)
    latestValue[symbol] = value
    bookValue += value
  }
  if (bookValue <= 0) return { message: 'No positions' }

  const weights: Record<string, number> = {}
  for (const symbol of covered) weights[symbol] = latestValue[symbol] / bookValue

  const riskFree = await getRiskFreeRate(portfolio?.currency ?? 'USD')
  const results = SCHEDULES.map((rebalance) =>
    backtestPortfolio(seriesBySymbol, weights, {
      rebalance,
      initialCapital: 10000,
      costPct: Number.isFinite(costPct) ? costPct : 0.1,
      riskFreeRate: riskFree.rate,
    }),
  ).filter((r): r is NonNullable<typeof r> => r !== null)

  if (results.length === 0) return { message: 'Not enough overlapping history' }

  return {
    weights,
    covered,
    // Holdings with no usable history are excluded from the whole exercise,
    // so the result describes a subset of the book and has to say so.
    excluded: missing,
    cost_pct: costPct,
    risk_free_rate: { annual_pct: riskFree.rate * 100, source: riskFree.source },
    observations: results[0].equityCurve.length,
    from: results[0].equityCurve[0]?.date ?? null,
    to: results[0].equityCurve[results[0].equityCurve.length - 1]?.date ?? null,
    schedules: results,
    note:
      'Which schedule comes out ahead depends on the period tested: rebalancing helps in a ' +
      'mean-reverting market and costs money in a trending one. This is one sample, not a rule.',
    _meta: buildResultMetadata({
      model: 'backtest',
      data: { description: 'Precios de cierre diarios de las posiciones, pesos actuales al inicio de la prueba', symbols: covered, excluded: missing, priceSource },
      period: {
        from: results[0].equityCurve[0]?.date ?? null,
        to: results[0].equityCurve[results[0].equityCurve.length - 1]?.date ?? null,
        observations: results[0].equityCurve.length,
        cadence: '1 dia',
      },
      assumptions: [
        COMMON_ASSUMPTIONS.splitAdjusted,
        COMMON_ASSUMPTIONS.priceReturn,
        { name: 'Costo por operación', value: `${costPct}% del monto negociado`, source: 'Parámetro de la prueba' },
        { name: 'Capital inicial', value: '10,000 (escala; los resultados son proporcionales)', source: 'backtest job' },
        { name: 'Sin mirar al futuro', value: 'Cada decisión solo usa datos hasta ese día', source: 'backtest.ts' },
      ],
      riskFreeRate: riskFree,
    }),
  }
}
