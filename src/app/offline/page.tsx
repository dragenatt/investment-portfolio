import type { Metadata } from 'next'
import Link from 'next/link'
import { CloudOff } from 'lucide-react'
import { RetryButton } from './retry-button'

// What the service worker shows (C4) when a page is opened without a connection
// and was never saved on this device. It is saved at install time together with
// the files it needs, so it renders offline. The address bar still shows the
// page that was asked for, which is what "Reintentar" reloads.

export const metadata: Metadata = {
  title: 'Sin conexión — InvestTracker',
  robots: { index: false },
}

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-4 text-center">
        <CloudOff className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">Sin conexión</h1>
        <p className="text-sm text-muted-foreground">
          Esta página no está guardada en este dispositivo. Las páginas que ya abriste con conexión siguen
          disponibles, con sus datos guardados y la fecha en que se guardaron.
        </p>
        <div className="flex items-center justify-center gap-3">
          <RetryButton />
          <Link href="/dashboard" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Ir al panel
          </Link>
        </div>
      </div>
    </main>
  )
}
