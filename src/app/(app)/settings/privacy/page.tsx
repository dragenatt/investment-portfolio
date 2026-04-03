'use client'

import { useState, useMemo } from 'react'
import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { Copy, Check } from 'lucide-react'

type VisibilityMode = 'public' | 'private' | 'shared'

interface PortfolioSettings {
  id: string
  visibility: VisibilityMode
  showAmounts: boolean
  showPositions: boolean
  showTransactions: boolean
  showAllocation: boolean
  shareToken?: string
  tags: string[]
}

export default function PrivacySettingsPage() {
  const { data: portfolios = [], isLoading } = usePortfolios()
  const [settings, setSettings] = useState<Record<string, PortfolioSettings>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  // Initialize settings from portfolios
  const initializedSettings = useMemo(() => {
    if (settings && Object.keys(settings).length > 0) {
      return settings
    }
    const initialized: Record<string, PortfolioSettings> = {}
    portfolios.forEach((p: any) => {
      if (!initialized[p.id]) {
        initialized[p.id] = {
          id: p.id,
          visibility: p.isPublic ? 'public' : 'private',
          showAmounts: p.showAmounts !== false,
          showPositions: p.showPositions !== false,
          showTransactions: p.showTransactions !== false,
          showAllocation: p.showAllocation !== false,
          shareToken: p.shareToken,
          tags: p.tags || [],
        }
      }
    })
    return initialized
  }, [portfolios, settings])

  const handleVisibilityChange = (portfolioId: string, visibility: VisibilityMode) => {
    setSettings((prev) => ({
      ...prev,
      [portfolioId]: {
        ...prev[portfolioId],
        visibility,
      },
    }))
  }

  const handleToggle = (portfolioId: string, field: string, value: boolean) => {
    setSettings((prev) => ({
      ...prev,
      [portfolioId]: {
        ...prev[portfolioId],
        [field]: value,
      },
    }))
  }

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token)
    setCopiedId(token)
    setTimeout(() => setCopiedId(null), 2000)
    toast.success('Token copiado')
  }

  const handleSave = async (portfolioId: string) => {
    setSaving((prev) => ({ ...prev, [portfolioId]: true }))
    try {
      const portfolioSettings = initializedSettings[portfolioId]
      const res = await fetch(`/api/portfolio/${portfolioId}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visibility: portfolioSettings.visibility,
          show_amounts: portfolioSettings.showAmounts,
          show_positions: portfolioSettings.showPositions,
          show_transactions: portfolioSettings.showTransactions,
          show_allocation: portfolioSettings.showAllocation,
          tags: portfolioSettings.tags,
        }),
      })

      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('Guardado')
      }
    } catch (err) {
      toast.error('Error al guardar')
    } finally {
      setSaving((prev) => ({ ...prev, [portfolioId]: false }))
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-3xl font-bold">Configuración de Privacidad</h1>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-64 rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Configuración de Privacidad</h1>
        <p className="text-muted-foreground">
          Controla quién puede ver tus portafolios y qué información compartir
        </p>
      </div>

      {/* Portfolio Cards */}
      {portfolios.length === 0 ? (
        <Card className="rounded-xl border-border">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No tienes portafolios</p>
          </CardContent>
        </Card>
      ) : (
        portfolios.map((portfolio: any) => {
          const settings = initializedSettings[portfolio.id]
          const isSaving = saving[portfolio.id]

          return (
            <Card key={portfolio.id} className="rounded-xl border-border">
              <CardHeader>
                <CardTitle className="text-lg">{portfolio.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Visibility Mode */}
                <div className="space-y-3">
                  <Label className="font-semibold">Visibilidad</Label>
                  <div className="space-y-2">
                    {(['public', 'private', 'shared'] as const).map((mode) => (
                      <div key={mode} className="flex items-center gap-3">
                        <input
                          type="radio"
                          id={`${portfolio.id}-${mode}`}
                          name={`visibility-${portfolio.id}`}
                          checked={settings.visibility === mode}
                          onChange={() => handleVisibilityChange(portfolio.id, mode)}
                          className="h-4 w-4 rounded-full border border-border cursor-pointer"
                        />
                        <label
                          htmlFor={`${portfolio.id}-${mode}`}
                          className="flex-1 cursor-pointer"
                        >
                          <span className="font-medium capitalize">
                            {mode === 'public'
                              ? 'Público'
                              : mode === 'private'
                                ? 'Privado'
                                : 'Compartido'}
                          </span>
                          <p className="text-xs text-muted-foreground">
                            {mode === 'public'
                              ? 'Visible para todos'
                              : mode === 'private'
                                ? 'Solo para ti'
                                : 'Solo para quienes tengan el enlace'}
                          </p>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Share Token (only for shared) */}
                {settings.visibility === 'shared' && settings.shareToken && (
                  <div className="space-y-2 p-3 rounded-lg bg-secondary/30 border border-border">
                    <Label className="text-xs font-semibold">Token de Compartir</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={settings.shareToken || ''}
                        readOnly
                        className="rounded-lg text-xs"
                      />
                      <Button
                        onClick={() => settings.shareToken && handleCopyToken(settings.shareToken)}
                        size="sm"
                        variant="outline"
                        className="rounded-lg flex-shrink-0"
                      >
                        {copiedId === settings.shareToken ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Data Visibility Toggles */}
                <div className="space-y-3 pt-4 border-t border-border">
                  <Label className="font-semibold">Mostrar Datos</Label>
                  <div className="space-y-2">
                    {[
                      { key: 'showAmounts', label: 'Montos' },
                      { key: 'showPositions', label: 'Posiciones' },
                      { key: 'showTransactions', label: 'Transacciones' },
                      { key: 'showAllocation', label: 'Asignación' },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id={`${portfolio.id}-${key}`}
                          checked={settings[key as keyof typeof settings] as boolean}
                          onChange={(e) => handleToggle(portfolio.id, key, e.target.checked)}
                          className="h-4 w-4 rounded border border-border cursor-pointer"
                        />
                        <label htmlFor={`${portfolio.id}-${key}`} className="cursor-pointer font-medium text-sm flex-1">
                          {label}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tags */}
                <div className="space-y-2 pt-4 border-t border-border">
                  <Label className="font-semibold">Etiquetas</Label>
                  <Input
                    placeholder="Separadas por comas"
                    value={settings.tags?.join(', ') || ''}
                    onChange={(e) => {
                      setSettings((prev) => ({
                        ...prev,
                        [portfolio.id]: {
                          ...prev[portfolio.id],
                          tags: e.target.value.split(',').map((t) => t.trim()),
                        },
                      }))
                    }}
                    className="rounded-xl"
                  />
                </div>

                {/* Save Button */}
                <div className="pt-4 border-t border-border">
                  <Button
                    onClick={() => handleSave(portfolio.id)}
                    disabled={isSaving}
                    className="rounded-xl w-full"
                  >
                    {isSaving ? 'Guardando...' : 'Guardar'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
