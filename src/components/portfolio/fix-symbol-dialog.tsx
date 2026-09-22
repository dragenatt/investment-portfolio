'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/lib/i18n'
import { checkSymbols, quoteCandidates } from '@/lib/utils/symbol-check'

type Props = {
  portfolioId: string
  positionId: string
  symbol: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onFixed: () => void
}

type Found = { symbol: string; price: number; currency: string }

/**
 * Renames a position whose symbol no provider recognises (PATCH
 * /api/portfolio/[id]/positions/[positionId]). On opening it asks the quote
 * service about the other spellings of the symbol — the BMV's ".MX" for a bare
 * ticker (symbol-check.ts) — and offers the one that prices.
 */
export function FixSymbolDialog({ portfolioId, positionId, symbol, open, onOpenChange, onFixed }: Props) {
  const { t } = useTranslation()
  const [value, setValue] = useState(symbol)
  const [found, setFound] = useState<Found | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const candidates = quoteCandidates(symbol)
    // Nothing to suggest for a symbol that already names its market.
    if (candidates.length < 2) return

    ;(async () => {
      setChecking(true)
      try {
        const res = await fetch(`/api/market/batch?symbols=${encodeURIComponent(candidates.join(','))}`)
        const json = await res.json()
        const quotes = (json.data ?? {}) as Record<string, { price: number | null; currency?: string }>
        const suggestion = checkSymbols([symbol], quotes).suggestions[symbol]
        if (!cancelled && suggestion) {
          const quote = quotes[suggestion] ?? quotes[suggestion.toUpperCase()]
          setValue(suggestion)
          setFound({ symbol: suggestion, price: Number(quote?.price), currency: quote?.currency ?? '' })
        }
      } catch {
        // No suggestion; the reader can still type the symbol.
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, symbol])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/portfolio/${portfolioId}/positions/${positionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: value }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error ?? t.common.error_occurred)
        return
      }
      toast.success(t.portfolio.fix_symbol_saved.replace('{symbol}', json.data.symbol))
      onOpenChange(false)
      onFixed()
    } catch {
      setError(t.common.error_occurred)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t.portfolio.fix_symbol_title.replace('{symbol}', symbol)}</DialogTitle>
            <DialogDescription>{t.portfolio.fix_symbol_desc.replace('{symbol}', symbol)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="fix-symbol-input">{t.portfolio.fix_symbol_label}</Label>
            <Input
              id="fix-symbol-input"
              value={value}
              onChange={(e) => setValue(e.target.value.toUpperCase())}
              autoComplete="off"
              className="font-mono"
              required
            />
            {checking && <p className="text-xs text-muted-foreground">{t.portfolio.fix_symbol_checking}</p>}
            {found && value === found.symbol && (
              <p role="status" className="text-xs text-gain">
                {t.portfolio.fix_symbol_found
                  .replace('{symbol}', found.symbol)
                  .replace('{price}', Number.isFinite(found.price) ? found.price.toFixed(2) : '--')
                  .replace('{currency}', found.currency)}
              </p>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={saving || value.trim() === '' || value === symbol}>
              {t.portfolio.fix_symbol_save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
