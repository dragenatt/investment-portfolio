'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { toast } from 'sonner'
import useSWR from 'swr'
import { OnboardingTour } from '@/components/shared/onboarding-tour'
import { useTranslation } from '@/lib/i18n'
import type { Locale } from '@/lib/i18n'
import { setLocaleCookie } from '@/lib/i18n/locale-client'
import { setKeyboardShortcutsEnabled, useKeyboardShortcutsEnabled } from '@/lib/hooks/use-keyboard-shortcuts-preference'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => {
  if (r.error) throw new Error(r.error)
  return r.data
})

export default function SettingsPage() {
  const { t, locale } = useTranslation()
  const { data: profile, mutate } = useSWR('/api/user/profile', fetcher)
  const { theme, setTheme } = useTheme()
  // Initialize from profile if available, otherwise empty string
  const [displayName, setDisplayName] = useState(profile?.display_name || '')
  const [baseCurrency, setBaseCurrency] = useState(profile?.base_currency || 'MXN')
  const [showTour, setShowTour] = useState(false)
  const shortcutsEnabled = useKeyboardShortcutsEnabled()

  async function saveProfile() {
    const res = await fetch('/api/user/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName }),
    })
    const data = await res.json()
    if (data.error) { toast.error(data.error); return }
    toast.success(t.common.success)
    mutate()
  }

  async function savePreferences() {
    const res = await fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_currency: baseCurrency, theme }),
    })
    const data = await res.json()
    if (data.error) { toast.error(data.error); return }
    toast.success(t.common.success)
    mutate()
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-3xl font-bold">{t.settings.title}</h1>

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader><CardTitle className="text-xl">{t.settings.profile}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="settings-name">{t.settings.name}</Label>
            <Input id="settings-name" className="rounded-xl" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-email">{t.settings.email}</Label>
            <Input id="settings-email" className="rounded-xl" value={profile?.email || ''} disabled />
          </div>
          <Button className="rounded-xl" onClick={saveProfile}>{t.settings.save_profile}</Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader><CardTitle className="text-xl">{t.settings.preferences}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="settings-currency">{t.settings.base_currency}</Label>
            <Select value={baseCurrency} onValueChange={(v) => v && setBaseCurrency(v)}>
              <SelectTrigger id="settings-currency" className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MXN">MXN</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-theme">{t.settings.theme}</Label>
            <Select value={theme} onValueChange={(v) => v && setTheme(v)}>
              <SelectTrigger id="settings-theme" className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t.settings.light}</SelectItem>
                <SelectItem value="dark">{t.settings.dark}</SelectItem>
                <SelectItem value="system">{t.settings.system}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-language">{locale === 'es' ? 'Idioma' : 'Language'}</Label>
            <Select value={locale} onValueChange={(v) => { if (v) { setLocaleCookie(v as Locale); window.location.reload() } }}>
              <SelectTrigger id="settings-language" className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="rounded-xl" onClick={savePreferences}>{t.settings.save_preferences}</Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader><CardTitle className="text-xl">Historial de cambios</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Qué cambió en tus portafolios, posiciones, transacciones y metas, cuándo, y de qué valor a cuál.
          </p>
          <Link href="/settings/history" className={cn(buttonVariants({ variant: 'outline' }), 'rounded-xl')}>
            Ver historial
          </Link>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader><CardTitle className="text-xl">Accesibilidad</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-start gap-3">
            <input
              id="settings-shortcuts"
              type="checkbox"
              className="mt-1 h-4 w-4 accent-primary"
              checked={shortcutsEnabled}
              onChange={(e) => setKeyboardShortcutsEnabled(e.target.checked)}
              aria-describedby="settings-shortcuts-help"
            />
            <div>
              <Label htmlFor="settings-shortcuts">Atajos de una tecla</Label>
              <p id="settings-shortcuts-help" className="text-sm text-muted-foreground mt-1">
                D, P, M, W, A, L, X, C, B y S abren secciones; T abre una operación nueva. Desactívalos si usas
                dictado por voz o un lector de pantalla y se activan sin querer. Ctrl+K sigue abriendo la búsqueda.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader><CardTitle className="text-xl">{t.settings.tutorial}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t.settings.tutorial_desc}
          </p>
          <Button
            className="rounded-xl"
            variant="outline"
            onClick={() => {
              try { localStorage.removeItem('onboarding_completed') } catch {}
              setShowTour(true)
            }}
          >
            {t.settings.view_tutorial}
          </Button>
        </CardContent>
      </Card>

      {showTour && (
        <OnboardingTour forceOpen onClose={() => setShowTour(false)} />
      )}
    </div>
  )
}
