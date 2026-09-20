import { describe, it, expect, vi, beforeEach } from 'vitest'

// company_data is read by the allocation breakdown, the exposure map,
// attribution, the optimiser's sector caps and the concentration notification
// — and nothing ever wrote to it. Four rows existed in production, seeded by
// hand, so "Por Sector" described four of thirty positions. Synthetic symbols
// except for the funds, whose profiles are public facts.

const finnhub = vi.hoisted(() => ({
  profiles: {} as Record<string, unknown>,
  asked: [] as string[],
}))

vi.mock('@/lib/services/finnhub', () => ({
  getCompanyProfile: async (symbol: string) => {
    finnhub.asked.push(symbol)
    return finnhub.profiles[symbol.toUpperCase()] ?? null
  },
}))

const {
  resolveProfile,
  knownFundProfile,
  refreshCompanyProfiles,
  PROFILE_TTL_DAYS,
} = await import('@/lib/services/company-profiles')

const NOW = Date.parse('2026-09-20T00:00:00Z')

beforeEach(() => {
  finnhub.profiles = {}
  finnhub.asked = []
})

describe('knownFundProfile', () => {
  it('knows an index is not a company', () => {
    expect(knownFundProfile('^N225')).toEqual({
      symbol: '^N225',
      name: 'Nikkei 225',
      sector: 'Index',
      hq: 'JP',
      marketCap: null,
    })
  })

  it('labels a sector fund by its mandate, not as "ETF"', () => {
    expect(knownFundProfile('VNQ')?.sector).toBe('Real Estate')
    expect(knownFundProfile('GLD')?.sector).toBe('Commodities')
    expect(knownFundProfile('VOO')?.sector).toBe('ETF')
  })

  it('has nothing to say about a company', () => {
    expect(knownFundProfile('AAPL')).toBeNull()
  })
})

describe('resolveProfile', () => {
  it('does not ask a provider about an index', async () => {
    await resolveProfile('^GSPC')
    expect(finnhub.asked).toEqual([])
  })

  it('reads the sector and country from the provider', async () => {
    finnhub.profiles.SYNTH = {
      symbol: 'SYNTH',
      name: 'Synth Corp',
      sector: 'Technology',
      country: 'US',
      marketCap: 1_000_000_000,
      website: null,
    }

    expect(await resolveProfile('SYNTH')).toEqual({
      symbol: 'SYNTH',
      name: 'Synth Corp',
      sector: 'Technology',
      hq: 'US',
      marketCap: 1_000_000_000,
    })
  })

  it('lets the listing suffix overrule the provider on the country', async () => {
    // A US provider reporting a Mexican listing as American would put it in
    // the wrong place on the map. The suffix is not a guess.
    finnhub.profiles['SYNTH.MX'] = {
      symbol: 'SYNTH.MX',
      name: 'Synth de Mexico',
      sector: 'Consumer Staples',
      country: 'US',
      marketCap: null,
      website: null,
    }

    expect((await resolveProfile('SYNTH.MX'))?.hq).toBe('MX')
  })

  it('still places a symbol the provider does not cover, by its suffix', async () => {
    expect(await resolveProfile('OTRA.SA')).toEqual({
      symbol: 'OTRA.SA',
      name: null,
      sector: null,
      hq: 'BR',
      marketCap: null,
    })
  })

  it('says nothing about a symbol nothing can classify', async () => {
    expect(await resolveProfile('NOTATICKER')).toBeNull()
  })
})

describe('refreshCompanyProfiles', () => {
  function admin(existing: Array<Record<string, unknown>>, written: Array<Record<string, unknown>>) {
    return {
      from: () => ({
        select: () => ({ in: async () => ({ data: existing, error: null }) }),
        upsert: async (row: Record<string, unknown>) => {
          written.push(row)
          return { error: null }
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a stub with the two calls this function makes
    } as any
  }

  it('writes a profile for a symbol that has none', async () => {
    const written: Array<Record<string, unknown>> = []
    const count = await refreshCompanyProfiles(admin([], written), ['VOO'], NOW)

    expect(count).toBe(1)
    expect(written[0]).toMatchObject({ symbol: 'VOO', sector: 'ETF', hq: 'US' })
  })

  it('leaves a stored, current profile alone', async () => {
    const written: Array<Record<string, unknown>> = []
    const fresh = [{
      symbol: 'VOO',
      sector: 'ETF',
      hq: 'US',
      expires_at: new Date(NOW + 86_400_000).toISOString(),
    }]

    expect(await refreshCompanyProfiles(admin(fresh, written), ['VOO'], NOW)).toBe(0)
    expect(written).toEqual([])
  })

  it('refills a row that has fundamentals but no sector', async () => {
    // The four hand-seeded rows are not the only shape this table comes in:
    // the fundamentals route writes P/E and a 52-week range with no sector.
    const written: Array<Record<string, unknown>> = []
    const partial = [{ symbol: 'QQQ', sector: null, hq: null, expires_at: new Date(NOW + 86_400_000).toISOString() }]

    expect(await refreshCompanyProfiles(admin(partial, written), ['QQQ'], NOW)).toBe(1)
  })

  it('writes only the fields it knows, so fundamentals survive', async () => {
    const written: Array<Record<string, unknown>> = []
    await refreshCompanyProfiles(admin([], written), ['^N225'], NOW)

    expect(Object.keys(written[0]).sort()).toEqual(['expires_at', 'fetched_at', 'hq', 'name', 'sector', 'symbol'])
    expect(written[0]).not.toHaveProperty('pe_ratio')
    expect(written[0]).not.toHaveProperty('market_cap')
  })

  it('gives a profile a month before asking again', async () => {
    const written: Array<Record<string, unknown>> = []
    await refreshCompanyProfiles(admin([], written), ['VOO'], NOW)

    expect(Date.parse(String(written[0].expires_at)) - NOW).toBe(PROFILE_TTL_DAYS * 86_400_000)
  })

  it('skips a symbol nothing can classify rather than writing an empty row', async () => {
    const written: Array<Record<string, unknown>> = []

    expect(await refreshCompanyProfiles(admin([], written), ['NOTATICKER'], NOW)).toBe(0)
    expect(written).toEqual([])
  })

  it('asks about each symbol once, however many positions hold it', async () => {
    const written: Array<Record<string, unknown>> = []
    finnhub.profiles.SYNTH = { symbol: 'SYNTH', name: null, sector: 'Technology', country: 'US', marketCap: null, website: null }

    await refreshCompanyProfiles(admin([], written), ['SYNTH', 'synth', 'SYNTH'], NOW)

    expect(finnhub.asked).toEqual(['SYNTH'])
  })
})
