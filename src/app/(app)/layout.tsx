import { AppShell } from '@/components/layout/app-shell'
import { CurrencyProvider } from '@/providers/currency-provider'
import { SWRConfigProvider } from '@/lib/api/swr-config'
import { SymbolSearch } from '@/components/market/symbol-search'
import { createServerSupabase } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { I18nProvider, getDictionary } from '@/lib/i18n'
import { getLocaleFromCookies } from '@/lib/i18n/locale'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const locale = await getLocaleFromCookies()
  const dictionary = await getDictionary(locale)

  return (
    <SWRConfigProvider>
      <CurrencyProvider>
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
