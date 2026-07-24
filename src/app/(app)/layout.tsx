import { AppShell } from '@/components/layout/app-shell'
import { CurrencyProvider } from '@/providers/currency-provider'
import { SWRConfigProvider } from '@/lib/api/swr-config'
import { SymbolSearch } from '@/components/market/symbol-search'
import { createServerSupabase } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { I18nProvider } from '@/lib/i18n'
import { getDictionary } from '@/lib/i18n/get-dictionary'
import { getLocaleFromCookies } from '@/lib/i18n/locale'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const locale = await getLocaleFromCookies()
  const dictionary = await getDictionary(locale)

  // Seed the display currency from the user's saved preference so the whole app
  // renders in their base currency on first paint (no flash of the default).
  const { data: profile } = await supabase
    .from('profiles')
    .select('base_currency')
    .eq('user_id', user.id)
    .single()
  const baseCurrency = profile?.base_currency ?? 'MXN'

  return (
    <SWRConfigProvider>
      <CurrencyProvider initialCurrency={baseCurrency}>
        <I18nProvider locale={locale} dictionary={dictionary}>
          <AppShell>
            {children}
            <SymbolSearch />
          </AppShell>
        </I18nProvider>
      </CurrencyProvider>
    </SWRConfigProvider>
  )
}
