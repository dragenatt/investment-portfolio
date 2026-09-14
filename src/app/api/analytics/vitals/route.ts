import { NextResponse } from 'next/server'
import { serviceRoleClient } from '@/lib/supabase/admin'
import { parseVital } from '@/lib/services/web-vitals'

/**
 * Field Core Web Vitals (C3).
 *
 * Open to signed-out pages, because the landing and login pages are exactly
 * where first impressions are measured — so the body is treated as hostile:
 * parseVital accepts only known metrics, plausible values and a route reduced
 * to its pattern. Nothing about the user is stored. The proxy's per-IP rate
 * limit applies like any other /api route.
 *
 * Answers 204 either way: sendBeacon ignores the response, and telling a
 * scripted caller which bodies were rejected would only help it.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const row = parseVital(body)
  const writer = serviceRoleClient()
  if (row && writer) {
    const { error } = await writer.from('web_vitals').insert(row)
    if (error) console.warn('[vitals] insert failed', error.message)
  }
  return new NextResponse(null, { status: 204 })
}
