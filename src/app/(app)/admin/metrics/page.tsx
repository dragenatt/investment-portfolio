import { notFound } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { analyticsAdminClient } from '@/lib/analytics/db'
import { FUNNEL_EVENT_NAMES, FUNNEL_LABELS } from '@/lib/analytics/events'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Internal metrics dashboard.
 *
 * Reads the two observability tables directly with the service role, so it needs
 * neither a Sentry nor a PostHog API token to show something useful on day one.
 *
 * Access: the email on the session must be listed in ADMIN_EMAILS. A non-admin
 * gets a 404 rather than a 403, so the page does not advertise that it exists.
 */

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

type ErrorRow = { route: string; method: string; message: string; created_at: string }

export default async function AdminMetricsPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const email = user?.email?.toLowerCase()
  const allowed = adminEmails()
  if (!email || allowed.length === 0 || !allowed.includes(email)) {
    notFound()
  }

  const admin = analyticsAdminClient()
  if (!admin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Métricas</CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Falta SUPABASE_SERVICE_ROLE_KEY: sin ella este panel no puede leer las
          tablas de observabilidad.
        </CardContent>
      </Card>
    )
  }

  const since24h = hoursAgo(24)
  const since7d = hoursAgo(24 * 7)

  const [errors24h, errors7d, recentErrors, funnelCounts] = await Promise.all([
    admin.from('error_events').select('*', { count: 'exact', head: true }).gte('created_at', since24h),
    admin.from('error_events').select('*', { count: 'exact', head: true }).gte('created_at', since7d),
    admin
      .from('error_events')
      .select('route, method, message, created_at')
      .gte('created_at', since7d)
      .order('created_at', { ascending: false })
      .limit(200),
    Promise.all(
      FUNNEL_EVENT_NAMES.map(async (event) => {
        const [total, week] = await Promise.all([
          admin.from('funnel_events').select('*', { count: 'exact', head: true }).eq('event', event),
          admin
            .from('funnel_events')
            .select('*', { count: 'exact', head: true })
            .eq('event', event)
            .gte('created_at', since7d),
        ])
        return { event, total: total.count ?? 0, week: week.count ?? 0 }
      })
    ),
  ])

  const rows = (recentErrors.data ?? []) as ErrorRow[]

  // Which endpoints are failing most in the last 7 days.
  const byRoute = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.method} ${row.route}`
    byRoute.set(key, (byRoute.get(key) ?? 0) + 1)
  }
  const topRoutes = [...byRoute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1
          className="font-bold tracking-tight font-serif"
          style={{ fontSize: 'clamp(24px, 3vw, 36px)', letterSpacing: '-0.03em' }}
        >
          Métricas
        </h1>
        <p className="text-sm text-muted-foreground font-semibold">
          Errores de API y funnel educativo, leídos de la base de datos propia
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Errores · 24 h</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold font-financial">{errors24h.count ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Errores · 7 días</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold font-financial">{errors7d.count ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Funnel educativo</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Conteo de eventos en funnel_events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {funnelCounts.map(({ event, total, week }) => (
              <div key={event} className="flex items-center justify-between gap-4">
                <span className="text-sm">{FUNNEL_LABELS[event]}</span>
                <div className="flex items-center gap-6 font-financial text-sm">
                  <span className="text-muted-foreground text-xs">7 d: {week}</span>
                  <span className="w-12 text-right font-semibold">{total}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Endpoints con más errores · 7 días</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Sobre las últimas {rows.length} entradas registradas
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topRoutes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Sin errores registrados en el periodo
            </p>
          ) : (
            <div className="space-y-3">
              {topRoutes.map(([route, count]) => (
                <div key={route} className="flex items-center justify-between gap-4">
                  <span className="font-mono text-xs truncate">{route}</span>
                  <span className="font-financial text-sm font-semibold shrink-0">{count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Últimos errores</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nada registrado todavía
            </p>
          ) : (
            <div className="space-y-3">
              {rows.slice(0, 15).map((row, i) => (
                <div key={`${row.created_at}-${i}`} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs">
                      {row.method} {row.route}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(row.created_at).toLocaleString('es-MX')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{row.message}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Nota: son conteos de errores, no una tasa. Para una tasa real haría falta
        contar también las peticiones exitosas, y escribir en base por cada
        petición cuesta más de lo que vale ese número — Vercel Analytics ya lleva
        ese denominador.
      </p>
    </div>
  )
}
