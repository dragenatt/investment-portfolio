'use client'

import { cn } from '@/lib/utils'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { formatPercent } from '@/lib/utils/numbers'
import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { changeTone, toneTextClass } from '@/lib/utils/change-tone'

type Props = {
  price: number
  change?: number
  changePct?: number
  currency?: string
  size?: 'sm' | 'md' | 'lg'
}

export function PriceDisplay({ price, change, changePct, currency = 'USD', size = 'md' }: Props) {
  const tone = changeTone(changePct, 2)
  const colorClass = toneTextClass(tone)

  const sizes = {
    sm: { price: 'text-sm', change: 'text-xs' },
    md: { price: 'text-lg font-semibold', change: 'text-sm' },
    lg: { price: 'text-3xl font-bold', change: 'text-base' },
  }

  return (
    <div className="flex items-baseline gap-2">
      <FormattedAmount value={price} from={currency} className={sizes[size].price} />
      {change != null && changePct != null && (
        <span className={cn('font-financial', sizes[size].change, colorClass, 'flex items-center gap-0.5')}>
          {tone === 'gain' ? <ArrowUp aria-hidden="true" className="h-3 w-3" /> : tone === 'loss' ? <ArrowDown aria-hidden="true" className="h-3 w-3" /> : <Minus aria-hidden="true" className="h-3 w-3" />}
          {formatPercent(changePct)}
        </span>
      )}
    </div>
  )
}
