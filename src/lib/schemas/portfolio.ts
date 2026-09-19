import { z } from 'zod'
import { BENCHMARKS } from '@/lib/services/benchmarks'

const BENCHMARK_SYMBOLS = BENCHMARKS.map((b) => b.symbol) as [string, ...string[]]

export const CreatePortfolioSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  base_currency: z.enum(['MXN', 'USD', 'EUR']).default('MXN'),
})

/**
 * The costs a portfolio pays, as the user states them (costs.ts CostModel).
 *
 * The ceilings are sanity bounds, not estimates: nothing here suggests what a
 * cost should be. A source is required so a net return always says whose
 * figures it rests on.
 */
export const CostModelSchema = z.object({
  commissionPct: z.number().min(0).max(10),
  commissionMin: z.number().min(0).max(1_000_000).optional(),
  spreadPct: z.number().min(0).max(10),
  custodyAnnualPct: z.number().min(0).max(10),
  capitalGainsTaxPct: z.number().min(0).max(60),
  source: z.string().trim().min(1, 'Indica de dónde salen estas cifras (tu broker, tu contrato).').max(200),
})

export const UpdatePortfolioSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  // Restricted to the known list: a free-text symbol would silently produce a
  // beta against a series that does not exist.
  benchmark_symbol: z.enum(BENCHMARK_SYMBOLS).optional(),
  /** Null clears it: every return goes back to being shown gross. */
  cost_model: CostModelSchema.nullable().optional(),
})
