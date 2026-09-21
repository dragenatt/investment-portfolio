import { describe, it, expect } from 'vitest'
import { evaluateConcentration } from '@/lib/services/concentration'

// On 2026-09-21 the nightly job warned three users that their book was
// concentrated in "the ETF sector" and three in "the Index sector". The job had
// just started filling company_data for funds and indices, and this rule
// counted a wrapper as an industry. Synthetic book.

const PID = 'p1'
const fund = (symbol: string, value: number) => ({ symbol, asset_type: 'etf', value })
const stock = (symbol: string, value: number) => ({ symbol, asset_type: 'stock', value })

const sectorAlerts = (alerts: ReturnType<typeof evaluateConcentration>) =>
  alerts.filter((a) => a.alert_type === 'sector_concentration')

describe('evaluateConcentration — sectors', () => {
  it('does not call a book of index funds concentrated in "the ETF sector"', () => {
    const positions = [fund('AAA', 30), fund('BBB', 30), fund('CCC', 30), stock('DDD', 10)]
    const sectors = { AAA: 'ETF', BBB: 'ETF', CCC: 'Index', DDD: 'Technology' }

    expect(sectorAlerts(evaluateConcentration(positions, 100, PID, sectors))).toEqual([])
  })

  it('still warns about a real sector over half the book', () => {
    const positions = [stock('AAA', 40), stock('BBB', 25), stock('CCC', 35)]
    const sectors = { AAA: 'Technology', BBB: 'Technology', CCC: 'Health Care' }

    const alerts = sectorAlerts(evaluateConcentration(positions, 100, PID, sectors))

    expect(alerts).toHaveLength(1)
    expect(alerts[0].details).toMatchObject({ sector: 'Technology' })
  })

  it('measures a real sector against the whole book, funds included', () => {
    // Technology is 45 of 100: under the threshold even though it is the only
    // real sector present. Dropping the funds from the denominator would have
    // made it 100%.
    const positions = [stock('AAA', 45), fund('BBB', 55)]
    const sectors = { AAA: 'Technology', BBB: 'ETF' }

    expect(sectorAlerts(evaluateConcentration(positions, 100, PID, sectors))).toEqual([])
  })

  it('leaves the "mostly ETFs" warning to the asset-type rule, where it is true', () => {
    const positions = [fund('AAA', 45), fund('BBB', 45), stock('CCC', 10)]
    const sectors = { AAA: 'ETF', BBB: 'ETF', CCC: 'Technology' }

    const alerts = evaluateConcentration(positions, 100, PID, sectors)

    expect(alerts.some((a) => a.alert_type === 'asset_type_concentration')).toBe(true)
    expect(sectorAlerts(alerts)).toEqual([])
  })
})
