import { NextResponse } from 'next/server'
import { createAdminSupabase, computePortfolioSnapshot } from '@/lib/services/snapshots'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to') || new Date().toISOString().split('T')[0]
  const portfolioId = url.searchParams.get('portfolio_id')

  if (!from) {
    return NextResponse.json({ error: 'Missing "from" date parameter' }, { status: 400 })
  }

  const supabase = createAdminSupabase()

  // Get portfolios to backfill
  let portfolioIds: string[] = []
  if (portfolioId) {
    portfolioIds = [portfolioId]
  } else {
    const { data } = await supabase.from('portfolios').select('id')
    portfolioIds = data?.map((p) => p.id) ?? []
  }

  // Generate date range
  const dates: string[] = []
  const current = new Date(from)
  const end = new Date(to)
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0])
    current.setDate(current.getDate() + 1)
  }

  let processed = 0
  let errors = 0

  for (const date of dates) {
    for (const pid of portfolioIds) {
      try {
        const snapshot = await computePortfolioSnapshot(supabase, pid, date)
        if (snapshot) {
          await supabase
            .from('portfolio_snapshots')
            .upsert(snapshot, { onConflict: 'portfolio_id,snapshot_date' })
          processed++
        }
      } catch (err) {
        console.error(`[backfill] Failed ${pid} on ${date}:`, err)
        errors++
      }
    }
    // Pause between dates to respect rate limits
    await new Promise((r) => setTimeout(r, 1000))
  }

  return NextResponse.json({ processed, errors, dates: dates.length, portfolios: portfolioIds.length })
}
