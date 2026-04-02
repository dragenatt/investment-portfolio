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
import { useTranslation } from '@/lib/i18n'

export default function NewPortfolioPage() {
  const { t } = useTranslation()
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

    toast.success(t.portfolio.portfolio_created)
    mutate('/api/portfolio')
    router.push(`/portfolio/${data.data.id}`)
  }

  return (
    <div className="max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>{t.portfolio.new_portfolio_title}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>{t.portfolio.portfolio_name}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Mi portafolio principal" required />
            </div>
            <div className="space-y-2">
              <Label>{t.portfolio.portfolio_description}</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Inversiones a largo plazo" />
            </div>
            <div className="space-y-2">
              <Label>{t.portfolio.base_currency}</Label>
              <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MXN">{t.portfolio.currency_mxn_full}</SelectItem>
                  <SelectItem value="USD">{t.portfolio.currency_usd_full}</SelectItem>
                  <SelectItem value="EUR">{t.portfolio.currency_eur_full}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t.portfolio.creating : t.portfolio.create_portfolio}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
