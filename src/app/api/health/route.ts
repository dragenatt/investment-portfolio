import { NextResponse } from 'next/server'

/**
 * Is the app up, and which build is answering.
 *
 * The proxy has exempted this path from its per-address limit since request
 * limits were added (src/proxy.ts) — for a route that was never written, so the
 * exemption guarded a 404. Anything that checks whether the app is alive needs
 * a path that needs no session, costs nothing and says something specific:
 * the build version identifies which deploy answered, which is the difference
 * between "the site is up" and "the site is up and it is the deploy I just
 * pushed".
 *
 * Deliberately no database check. The route is exempt from the rate limit, so
 * anything it does, anyone can ask it to do without limit; a query here would
 * be a way to make this app query its database as fast as the network allows.
 * Whether the database is reachable is what every other route already answers.
 *
 * Nothing here is configuration: the version is the commit prefix, which is
 * public, and the time is the clock.
 */

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      version: process.env.NEXT_PUBLIC_BUILD_VERSION ?? 'unknown',
      time: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
