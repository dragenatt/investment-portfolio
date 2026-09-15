// @vitest-environment node
//
// CPU cost of one Monte Carlo request (C8): the simulation the analytics route
// and the background job run, at the size they run it — 1,500 paths, a year of
// daily history per holding — for the horizons the UI offers (26/52/104 weeks)
// and the maximum the API accepts (260), with 3, 10 and 25 holdings.
//
//   npx vitest bench --run tests/load
//
// The simulation is synchronous JavaScript: while it runs, the process serves
// nothing else. docs/LOAD_TEST_RESULTS.md turns these timings into what N
// concurrent requests on one instance wait.

import { bench, describe } from 'vitest'
import { simulatePortfolioGBM, type MonteCarloAsset } from '@/lib/services/monte-carlo'
import { createNormalSampler } from '@/lib/utils/random'

const SIMULATIONS = 1500 // src/lib/jobs/kinds/monte-carlo.ts
const LOOKBACK_DAYS = 252

function syntheticAssets(count: number): MonteCarloAsset[] {
  const normal = createNormalSampler(20260914 + count)
  return Array.from({ length: count }, (_, i) => ({
    symbol: `A${i}`,
    weight: 1 / count,
    // ~18% annual volatility, a small positive drift, and a common factor so
    // the correlation matrix is not the identity.
    historicalReturns: Array.from({ length: LOOKBACK_DAYS }, () => 0.0003 + 0.008 * normal() + 0.006 * normal()),
  }))
}

for (const holdings of [3, 10, 25]) {
  const assets = syntheticAssets(holdings)
  describe(`${holdings} holdings, ${SIMULATIONS} paths`, () => {
    for (const weeks of [26, 52, 104, 260]) {
      bench(`${weeks} weeks`, () => {
        simulatePortfolioGBM({ assets, weeks, numSimulations: SIMULATIONS, seed: 42 })
      }, { iterations: 5, warmupIterations: 1 })
    }
  })
}
