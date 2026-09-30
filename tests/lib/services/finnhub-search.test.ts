import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchSymbols } from '@/lib/services/finnhub'

describe('Finnhub symbol search', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubEnv('FINNHUB_API_KEY', 'test-key')
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it('reads the kind of instrument as its type and the market from the suffix', async () => {
    // The shape of finnhub.io/api/v1/search: the market is only in the suffix.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        count: 4,
        result: [
          { description: 'APPLE INC', displaySymbol: 'AAPL', symbol: 'AAPL', type: 'Common Stock' },
          { description: 'BERKSHIRE HATHAWAY INC-CL B', displaySymbol: 'BRK.B', symbol: 'BRK.B', type: 'Common Stock' },
          { description: 'WALMART DE MEXICO SAB DE CV', displaySymbol: 'WALMEX.MX', symbol: 'WALMEX.MX', type: 'Common Stock' },
          { description: 'BP PLC', displaySymbol: 'BP.L', symbol: 'BP.L', type: 'Common Stock' },
        ],
      }),
    })

    const results = await searchSymbols('x')

    expect(results).toEqual([
      { symbol: 'AAPL', name: 'APPLE INC', type: 'Common Stock', exchange: 'US', exchDisp: 'US' },
      // A share class is not a market.
      { symbol: 'BRK.B', name: 'BERKSHIRE HATHAWAY INC-CL B', type: 'Common Stock', exchange: 'US', exchDisp: 'US' },
      { symbol: 'WALMEX.MX', name: 'WALMART DE MEXICO SAB DE CV', type: 'Common Stock', exchange: 'BMV', exchDisp: 'BMV' },
      { symbol: 'BP.L', name: 'BP PLC', type: 'Common Stock', exchange: 'L', exchDisp: 'L' },
    ])
    expect(String(fetchMock.mock.calls[0][0])).toContain('token=test-key')
  })

  it('asks nothing without a key', async () => {
    vi.stubEnv('FINNHUB_API_KEY', '')

    expect(await searchSymbols('apple')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
