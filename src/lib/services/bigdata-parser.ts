export type ParsedCompanyData = {
  name: string
  description: string
  sector: string
  industry: string
  market_cap: number | null
  pe_ratio: number | null
  eps: number | null
  dividend_yield: number | null
  week52_high: number | null
  week52_low: number | null
  employees: number | null
  ceo: string | null
  hq: string | null
  website: string | null
  analyst_rating: string | null
  analyst_target_price: number | null
  revenue_ttm: number | null
  net_income_ttm: number | null
  competitors: string[]
}

export function parseCompanyTearsheet(markdown: string): ParsedCompanyData {
  const extract = (label: string): string | null => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i')
    const m = markdown.match(re)
    return m ? m[1].trim() : null
  }

  const extractBillions = (val: string | null): number | null => {
    if (!val) return null
    const m = val.match(/([\d,.]+)\s*([TB])?/)
    if (!m) return null
    let num = parseFloat(m[1].replace(/,/g, ''))
    if (m[2] === 'T') num *= 1_000_000_000_000
    else if (m[2] === 'B') num *= 1_000_000_000
    return isNaN(num) ? null : num
  }

  // Extract name from title
  const nameMatch = markdown.match(/^#\s+(.+)$/m)
  const name = nameMatch ? nameMatch[1].trim() : ''

  // Extract description
  const descMatch = markdown.match(/### Description\n(.+?)(\n\n|$)/s)
  const description = descMatch ? descMatch[1].trim() : ''

  // Extract P/E from Financial Ratios table
  const peMatch = markdown.match(/\| P\/E Ratio \| ([\d.]+)x/)
  const pe_ratio = peMatch ? parseFloat(peMatch[1]) : null

  // Extract EPS from latest earnings
  const epsMatch = markdown.match(/### EPS\n- \*\*Actual:\*\*\s*\$([\d.]+)/)
  const eps = epsMatch ? parseFloat(epsMatch[1]) : null

  // Extract dividend yield
  const dyMatch = markdown.match(/\| Dividend Yield \| ([\d.]+)%/)
  const dividend_yield = dyMatch ? parseFloat(dyMatch[1]) : null

  // Extract employees
  const empVal = extract('Employees')
  const employees = empVal ? parseInt(empVal.replace(/,/g, ''), 10) || null : null

  // Extract analyst consensus
  const consensusMatch = markdown.match(/\*\*Consensus:\*\*\s*(\w+)/)
  const analyst_rating = consensusMatch ? consensusMatch[1] : null

  // Extract analyst target price (from Price Targets section)
  const targetSection = markdown.match(/### Price Targets[\s\S]*?\*\*Consensus:\*\*\s*\$([\d,.]+)/)
  const analyst_target_price = targetSection
    ? parseFloat(targetSection[1].replace(/,/g, ''))
    : null

  // Extract competitors
  const competitors: string[] = []
  const compSection = markdown.match(/### Competitors[\s\S]*?(?=\n## |\n### |$)/i)
  if (compSection) {
    const tickerMatches = compSection[0].matchAll(/\|\s*([A-Z]{1,5})\s*\|/g)
    for (const tm of tickerMatches) {
      if (!['Symbol', '---', 'Ticker'].includes(tm[1])) competitors.push(tm[1])
    }
  }

  return {
    name,
    description,
    sector: extract('Sector') ?? '',
    industry: extract('Industry') ?? '',
    market_cap: extractBillions(extract('Market Cap')),
    pe_ratio,
    eps,
    dividend_yield,
    week52_high: (() => {
      const v = extract('52-Week High')
      if (!v) return null
      const n = parseFloat(v.replace(/[$,]/g, ''))
      return isNaN(n) ? null : n
    })(),
    week52_low: (() => {
      const v = extract('52-Week Low')
      if (!v) return null
      const n = parseFloat(v.replace(/[$,]/g, ''))
      return isNaN(n) ? null : n
    })(),
    employees,
    ceo: extract('CEO'),
    hq: extract('Country'),
    website: extract('Website'),
    analyst_rating,
    analyst_target_price,
    revenue_ttm: null,
    net_income_ttm: null,
    competitors,
  }
}

export type ParsedEvent = {
  symbol: string
  event_type: 'earnings' | 'dividend' | 'conference'
  event_date: string
  title: string
  description: string
}

export function parseEventsCalendar(markdown: string): ParsedEvent[] {
  const events: ParsedEvent[] = []

  // Parse earnings rows from markdown tables
  const earningsRows = markdown.matchAll(
    /\|\s*([A-Z.]{1,6})\s*\|\s*(.+?)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|/g
  )
  for (const row of earningsRows) {
    if (row[1] === 'TICKER' || row[1].startsWith('-')) continue
    events.push({
      symbol: row[1],
      event_type: 'earnings',
      event_date: row[3],
      title: `${row[2].trim()} Earnings (${row[5]})`,
      description: `Earnings call: ${row[4].trim()}`,
    })
  }

  return events
}
