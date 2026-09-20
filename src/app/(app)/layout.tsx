import { AppShell } from '@/components/layout/app-shell'
import { CurrencyProvider } from '@/providers/currency-provider'
import { SWRConfigProvider } from '@/lib/api/swr-config'
import { SymbolSearch } from '@/components/market/symbol-search'
import { AnalyticsInit } from '@/components/analytics/analytics-init'
import { createServerSupabase } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { I18nProvider } from '@/lib/i18n'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { getLocaleFromCookies } from '@/lib/i18n/locale'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()

  // Everything this layout needs runs before the first byte of every page in
  // the app, so what can overlap does. Four awaits in a row became two rounds:
  // the session and the locale have nothing to do with each other, and the
  // dictionary only needs the locale — not the profile, which only needs the
  // user. Measured p75 TTFB before this: /advisor 3.8s, /dashboard 2.8s.
  const [{ data: { user } }, locale] = await Promise.all([
    supabase.auth.getUser(),
    getLocaleFromCookies(),
  ])
  if (!user) redirect('/login')

  // Seed the display currency from the user's saved preference so the whole app
  // renders in their base currency on first paint (no flash of the default).
  const [dictionary, { data: profile }] = await Promise.all([
    getDictionary(locale),
    supabase.from('profiles').select('base_currency').eq('user_id', user.id).single(),
  ])
  const baseCurrency = profile?.base_currency ?? 'MXN'

  return (
    <SWRConfigProvider>
      <CurrencyProvider initialCurrency={baseCurrency}>
        <I18nProvider locale={locale} dictionary={dictionary}>
          <AppShell>
            {children}
            <SymbolSearch />
            <AnalyticsInit userId={user.id} />
          </AppShell>
        </I18nProvider>
      </CurrencyProvider>
    </SWRConfigProvider>
  )
}
