// Gain, loss or no change — decided the way the number is shown (C9). No I/O.
//
// Components used `value >= 0` to pick green and a "+": a day with no movement
// read as a gain ("+0.00% ↑" in green), and -0.001 printed as "-0.00%". The tone
// is decided on the value rounded to the precision on screen, so what the eye
// reads and what the colour says always agree, and "flat" has its own look.
//
// Colour is never the only carrier (WCAG 1.4.1): every tone has a sign and a
// word, and components show at least one of them next to the colour.

export type ChangeTone = 'gain' | 'loss' | 'flat'

/** Tone of a change at the precision it is displayed with; null when there is no number. */
export function changeTone(value: number | null | undefined, decimals = 2): ChangeTone | null {
  if (value == null || !Number.isFinite(value)) return null
  const rounded = Number(value.toFixed(decimals))
  if (rounded === 0) return 'flat'
  return rounded > 0 ? 'gain' : 'loss'
}

/** Tailwind text colour for a tone. Flat is muted, not green. */
export function toneTextClass(tone: ChangeTone | null): string {
  if (tone === 'gain') return 'text-gain'
  if (tone === 'loss') return 'text-loss'
  return 'text-muted-foreground'
}

/** CSS colour for components that style inline. */
export function toneColor(tone: ChangeTone | null): string {
  if (tone === 'gain') return 'var(--good)'
  if (tone === 'loss') return 'var(--bad)'
  return 'var(--muted-foreground)'
}

/** "+", "-" or "" — never a sign on zero. */
export function toneSign(tone: ChangeTone | null): string {
  if (tone === 'gain') return '+'
  if (tone === 'loss') return '-'
  return ''
}

/** The direction in words, for screen readers and summaries. */
export function toneWord(tone: ChangeTone | null): string {
  if (tone === 'gain') return 'sube'
  if (tone === 'loss') return 'baja'
  if (tone === 'flat') return 'sin cambio'
  return 'sin dato'
}

/** "+1.23%", "-1.23%", "0.00%", "--". */
export function formatSignedPercent(value: number | null | undefined, decimals = 2): string {
  const tone = changeTone(value, decimals)
  if (tone === null) return '--'
  return `${toneSign(tone)}${Math.abs(value as number).toFixed(decimals)}%`
}

/** "+1.23", "-1.23", "0.00", "--". */
export function formatSignedNumber(value: number | null | undefined, decimals = 2): string {
  const tone = changeTone(value, decimals)
  if (tone === null) return '--'
  return `${toneSign(tone)}${Math.abs(value as number).toFixed(decimals)}`
}
