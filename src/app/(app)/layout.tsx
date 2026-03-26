import { AppShell } from '@/components/layout/app-shell'
import { CurrencyProvider } from '@/providers/currency-provider'
import { SWRConfigProvider } from '@/lib/api/swr-config'
import { SymbolSearch } from '@/components/market/symbol-search'
import { createServerSupabase } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <SWRConfigProvider>
      <CurrencyProvider>
        <AppShell>
          {children}
        </AppShell>
        <SymbolSearch />
      </CurrencyProvider>
    </SWRConfigProvider>
  )
}
