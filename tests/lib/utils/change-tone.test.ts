import { describe, it, expect } from 'vitest'
import {
  changeTone,
  formatSignedNumber,
  formatSignedPercent,
  toneSign,
  toneTextClass,
  toneWord,
} from '@/lib/utils/change-tone'
import { formatPercent } from '@/lib/utils/numbers'

describe('changeTone', () => {
  it('reads gain and loss from the sign', () => {
    expect(changeTone(1.5)).toBe('gain')
    expect(changeTone(-0.3)).toBe('loss')
  })

  it('calls zero flat — it used to be a green "+0.00% ↑"', () => {
    expect(changeTone(0)).toBe('flat')
    expect(toneTextClass(changeTone(0))).toBe('text-muted-foreground')
    expect(toneSign(changeTone(0))).toBe('')
  })

  it('decides at the displayed precision, so colour and digits agree', () => {
    expect(changeTone(0.004)).toBe('flat')
    expect(changeTone(-0.004)).toBe('flat')
    expect(changeTone(0.006)).toBe('gain')
    expect(changeTone(0.04, 1)).toBe('flat')
  })

  it('has no tone without a number', () => {
    expect(changeTone(null)).toBeNull()
    expect(changeTone(undefined)).toBeNull()
    expect(changeTone(Number.NaN)).toBeNull()
  })

  it('has a word for every tone, so colour is never the only signal', () => {
    expect(toneWord('gain')).toBe('sube')
    expect(toneWord('loss')).toBe('baja')
    expect(toneWord('flat')).toBe('sin cambio')
  })
})

describe('formatSignedPercent / formatSignedNumber', () => {
  it('signs gains and losses and never zero', () => {
    expect(formatSignedPercent(1.234)).toBe('+1.23%')
    expect(formatSignedPercent(-1.234)).toBe('-1.23%')
    expect(formatSignedPercent(0)).toBe('0.00%')
    expect(formatSignedPercent(-0.001)).toBe('0.00%')
    expect(formatSignedNumber(-0.001)).toBe('0.00')
    expect(formatSignedPercent(null)).toBe('--')
  })
})

describe('formatPercent', () => {
  it('no longer prints "+0.00%" or "-0.00%"', () => {
    expect(formatPercent(0)).toBe('0.00%')
    expect(formatPercent(-0.001)).toBe('0.00%')
    expect(formatPercent(2.5)).toBe('+2.50%')
    expect(formatPercent(-2.5)).toBe('-2.50%')
    expect(formatPercent(null)).toBe('--')
  })
})
