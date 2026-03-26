import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { MobileNav } from '@/components/layout/mobile-nav'
import { CurrencyProvider } from '@/providers/currency-provider'
import { SWRConfigProvider } from '@/lib/api/swr-config'
import { SymbolSearch } from '@/components/market/symbol-search'
import { Breadcrumbs } from '@/components/shared/breadcrumbs'
import { createServerSupabase } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <SWRConfigProvider>
      <CurrencyProvider>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            <Header />
            <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
              <Breadcrumbs />
              {children}
            </main>
          </div>
          <MobileNav />
          <SymbolSearch />
        </div>
      </CurrencyProvider>
    </SWRConfigProvider>
  )
}
