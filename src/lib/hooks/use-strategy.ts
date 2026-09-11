import { useState, useCallback } from 'react'
import type { Strategy } from '@/lib/services/strategy-rule'
import type { StrategyRun, StrategyComparison } from '@/lib/services/strategy-engine'

export type StrategyBacktest = {
  symbol: string
  valid?: boolean
  errors?: string[]
  warnings?: string[]
  message?: string
  bars?: number
  from_date?: string
  to_date?: string
  cost_pct?: number
  risk_free_rate?: { annual_pct: number; source: string }
  own?: StrategyRun | null
  comparison?: StrategyComparison
  caveat?: string
}

/**
 * Run a built strategy against one symbol.
 *
 * Not SWR: this is a POST the user triggers, and re-running the same rules is
 * the point rather than something to dedupe away.
 */
export function useStrategyBacktest(symbol: string) {
  const [data, setData] = useState<StrategyBacktest | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (strategy: Strategy | null, includeExamples = true) => {
      setIsRunning(true)
      setError(null)
      try {
        const res = await fetch(`/api/market/${encodeURIComponent(symbol)}/strategy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategy: strategy ?? undefined, includeExamples }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error ?? 'No se pudo ejecutar el backtest.')
        setData(body.data ?? body)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo ejecutar el backtest.')
        setData(null)
      } finally {
        setIsRunning(false)
      }
    },
    [symbol],
  )

  return { data, isRunning, error, run }
}
