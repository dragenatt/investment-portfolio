'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'

export default function NewPortfolioPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState('MXN')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { mutate } = useSWRConfig()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const res = await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, base_currency: currency }),
    })
    const data = await res.json()

    if (data.error) { toast.error(data.error); setLoading(false); return }

    toast.success('Portafolio creado')
    mutate('/api/portfolio')
    router.push(`/portfolio/${data.data.id}`)
  }

  return (
    <div className="max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Nuevo Portafolio</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Mi portafolio principal" required />
            </div>
            <div className="space-y-2">
              <Label>Descripcion (opcional)</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Inversiones a largo plazo" />
            </div>
            <div className="space-y-2">
              <Label>Moneda base</Label>
              <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MXN">MXN - Peso Mexicano</SelectItem>
                  <SelectItem value="USD">USD - Dolar</SelectItem>
                  <SelectItem value="EUR">EUR - Euro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creando...' : 'Crear Portafolio'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
