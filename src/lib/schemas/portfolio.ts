import { z } from 'zod'
import { BENCHMARKS } from '@/lib/services/benchmarks'

const BENCHMARK_SYMBOLS = BENCHMARKS.map((b) => b.symbol) as [string, ...string[]]

export const CreatePortfolioSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  base_currency: z.enum(['MXN', 'USD', 'EUR']).default('MXN'),
})

export const UpdatePortfolioSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  // Restricted to the known list: a free-text symbol would silently produce a
  // beta against a series that does not exist.
  benchmark_symbol: z.enum(BENCHMARK_SYMBOLS).optional(),
})
