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
            <Label>{t.settings.name}</Label>
            <Input className="rounded-xl" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t.settings.email}</Label>
            <Input className="rounded-xl" value={profile?.email || ''} disabled />
          </div>
          <Button className="rounded-xl" onClick={saveProfile}>{t.settings.save_profile}</Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader><CardTitle className="text-xl">{t.settings.preferences}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t.settings.base_currency}</Label>
            <Select value={baseCurrency} onValueChange={(v) => v && setBaseCurrency(v)}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MXN">MXN</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t.settings.theme}</Label>
            <Select value={theme} onValueChange={(v) => v && setTheme(v)}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t.settings.light}</SelectItem>
                <SelectItem value="dark">{t.settings.dark}</SelectItem>
                <SelectItem value="system">{t.settings.system}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{locale === 'es' ? 'Idioma' : 'Language'}</Label>
            <Select value={locale} onValueChange={(v) => { if (v) { setLocaleCookie(v as Locale); window.location.reload() } }}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
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
