/**
 * Supabase Edge Function: Update current prices from market data
 *
 * Triggered by pg_cron every 60 seconds during market hours
 * - Reads all distinct active symbols from positions table
 * - Fetches batch quotes from Twelve Data
 * - Upserts into current_prices table
 * - Returns success/failure count
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Market hours check: Mon-Fri, 9:30-16:00 ET = 14:30-21:00 UTC
function isMarketHours(): boolean {
  const now = new Date()
  const day = now.getUTCDay() // 0 = Sunday, 5 = Friday, 6 = Saturday
  const hour = now.getUTCHours()
  const minutes = now.getUTCMinutes()

  // Market closed on weekends
  if (day === 0 || day === 6) return false

  // Market open: 14:30-21:00 UTC (9:30-16:00 ET)
  const currentMinutes = hour * 60 + minutes
  const marketOpenMinutes = 14 * 60 + 30 // 14:30
  const marketCloseMinutes = 21 * 60      // 21:00

  return currentMinutes >= marketOpenMinutes && currentMinutes < marketCloseMinutes
}

// Simple debounce: only update if the last update was more than 30 seconds ago
const DEBOUNCE_MS = 30_000
let lastUpdateTime = 0

Deno.serve(async (req: Request) => {
  try {
    // Check market hours
    if (!isMarketHours()) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Market is closed',
          updated: 0,
          failed: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Debounce: skip if last update was recent
    const now = Date.now()
    if (now - lastUpdateTime < DEBOUNCE_MS) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Debounced (last update too recent)',
          updated: 0,
          failed: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    lastUpdateTime = now

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Read all distinct active symbols from positions table
    const { data: positions, error: posError } = await supabase
      .from('positions')
      .select('symbol')
      .neq('quantity', 0)

    if (posError) {
      console.error('Error fetching positions:', posError)
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Failed to fetch positions',
          updated: 0,
          failed: 0,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const uniqueSymbols = Array.from(
      new Set((positions || []).map((p: Record<string, unknown>) => p.symbol as string))
    )

    if (uniqueSymbols.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No positions found',
          updated: 0,
          failed: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 2. Fetch quotes from Twelve Data API
    // Note: In production, call your market.ts service via HTTP
    // For now, we'll make direct API calls to Twelve Data
    const twelveDataKey = Deno.env.get('TWELVE_DATA_API_KEY')

    if (!twelveDataKey) {
      console.warn('TWELVE_DATA_API_KEY not set, skipping price update')
      return new Response(
        JSON.stringify({
          success: false,
          message: 'TWELVE_DATA_API_KEY not configured',
          updated: 0,
          failed: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const batchResults: Array<Record<string, unknown>> = []
    let updated = 0
    let failed = 0

    // Fetch in batches (Twelve Data allows ~20 symbols per call)
    const batchSize = 20
    for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
      const batch = uniqueSymbols.slice(i, i + batchSize)
      const symbolStr = batch.join(',')

      try {
        const res = await fetch(
          `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbolStr)}&apikey=${twelveDataKey}`,
          { signal: AbortSignal.timeout(5000) }
        )

        if (!res.ok) {
          console.error(`Twelve Data API error: ${res.status}`)
          failed += batch.length
          continue
        }

        const data = await res.json()
        const items = Array.isArray(data) ? data : [data]

        for (const item of items) {
          if (item.status === 'error' || item.code) {
            failed++
            continue
          }

          const symbol = item.symbol || ''
          const price = item.close ? parseFloat(item.close) : null
          const changePct = item.percent_change ? parseFloat(item.percent_change) : null
          const currency = item.currency || 'USD'

          if (symbol && price) {
            batchResults.push({
              symbol,
              price,
              change_pct: changePct,
              currency,
              source: 'twelve-data',
              fetched_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 60000).toISOString(),
            })
            updated++
          } else {
            failed++
          }
        }
      } catch (error) {
        console.error(`Error fetching batch: ${error instanceof Error ? error.message : String(error)}`)
        failed += batch.length
      }
    }

    // 3. Upsert into current_prices table
    if (batchResults.length > 0) {
      const { error: upsertError } = await supabase
        .from('current_prices')
        .upsert(batchResults, {
          onConflict: 'symbol,exchange',
        })

      if (upsertError) {
        console.error('Error upserting prices:', upsertError)
        failed = Math.max(failed, batchResults.length - updated)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Updated ${updated} prices`,
        updated,
        failed,
        totalSymbols: uniqueSymbols.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Unexpected error:', error instanceof Error ? error.message : String(error))
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Internal server error',
        updated: 0,
        failed: 0,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
