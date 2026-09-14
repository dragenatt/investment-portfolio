'use client'

import { useState } from 'react'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { Breadcrumbs } from '@/components/shared/breadcrumbs'
import { TradeProvider } from '@/lib/contexts/trade-context'
import { UniversalTradeModal } from '@/components/trade/universal-trade-modal'
import { OfflineBanner } from '@/components/pwa/offline-banner'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <TradeProvider>
      {/* First tab stop on every page: past the sidebar's eleven links to the content (C5). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Saltar al contenido
      </a>
      <div className="flex min-h-screen">
        <Sidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar onMenuClick={() => setMobileOpen(true)} />
          <OfflineBanner />
          <main id="main-content" tabIndex={-1} className="flex-1 p-4 md:p-6 focus:outline-none">
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
