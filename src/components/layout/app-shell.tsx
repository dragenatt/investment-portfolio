'use client'

import { useState } from 'react'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { Breadcrumbs } from '@/components/shared/breadcrumbs'
import { TradeProvider } from '@/lib/contexts/trade-context'
import { UniversalTradeModal } from '@/components/trade/universal-trade-modal'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <TradeProvider>
      <div className="flex min-h-screen">
        <Sidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar onMenuClick={() => setMobileOpen(true)} />
          <main className="flex-1 p-4 md:p-6">
            <Breadcrumbs />
            <div className="animate-fade-in">
              {children}
            </div>
          </main>
        </div>
        <UniversalTradeModal />
      </div>
    </TradeProvider>
  )
}
