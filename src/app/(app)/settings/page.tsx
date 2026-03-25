'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTheme } from 'next-themes'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => {
  if (r.error) throw new Error(r.error)
  return r.data
})

export default function SettingsPage() {
  const { data: profile, mutate } = useSWR('/api/user/profile', fetcher)
  const { theme, setTheme } = useTheme()
  const [displayName, setDisplayName] = useState('')
  const [baseCurrency, setBaseCurrency] = useState('MXN')

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || '')
      setBaseCurrency(profile.base_currency || 'MXN')
    }
  }, [profile])

  async function saveProfile() {
    const res = await fetch('/api/user/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName }),
    })
    const data = await res.json()
    if (data.error) { toast.error(data.error); return }
    toast.success('Perfil actualizado')
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
    toast.success('Preferencias guardadas')
    mutate()
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-3xl font-bold">Ajustes</h1>

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader><CardTitle className="text-xl">Perfil</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input className="rounded-xl" value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input className="rounded-xl" value={profile?.email || ''} disabled />
          </div>
          <Button className="rounded-xl" onClick={saveProfile}>Guardar perfil</Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader><CardTitle className="text-xl">Preferencias</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Moneda base</Label>
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
            <Label>Tema</Label>
            <Select value={theme} onValueChange={(v) => v && setTheme(v)}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Claro</SelectItem>
                <SelectItem value="dark">Oscuro</SelectItem>
                <SelectItem value="system">Sistema</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="rounded-xl" onClick={savePreferences}>Guardar preferencias</Button>
        </CardContent>
      </Card>
    </div>
  )
}
