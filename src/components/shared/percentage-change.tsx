'use client'

import { cn } from '@/lib/utils'
import { changeTone, formatSignedPercent, toneTextClass, toneWord } from '@/lib/utils/change-tone'

type Props = {
  value: number | null | undefined
  className?: string
}

export function PercentageChange({ value, className }: Props) {
  if (value == null) {
    return <span className={cn('font-mono', className)}>--</span>
  }

  // Sign, arrow and colour all come from the same rounded tone (C9); a flat day
  // gets no arrow and no green. The arrow is decoration: the sign carries the
  // direction for screen readers, with the word added for the flat case.
  const tone = changeTone(value, 2)
  const arrow = tone === 'gain' ? '\u2191' : tone === 'loss' ? '\u2193' : ''

  return (
    <span className={cn('font-mono', toneTextClass(tone), className)}>
      {formatSignedPercent(value, 2)}
      {arrow && <span aria-hidden="true"> {arrow}</span>}
      {tone === 'flat' && <span className="sr-only"> ({toneWord(tone)})</span>}
    </span>
  )
}
