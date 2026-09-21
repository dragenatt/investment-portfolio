import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// A position carries two currencies and they are routinely different: the one
// it TRADES in and the one it was BOUGHT in. Three screens forgot that and
// subtracted one from the other — the portfolio table, the asset page's "your
// position" card, and the public view a stranger sees of a shared portfolio.
// All three reported a ~94% loss on a healthy book, because seventeen is the
// peso-dollar rate.
//
// positionValuation() takes plain numbers and cannot know what they are
// denominated in. Screens go through
// positionInDisplayCurrency() and routes through valueBookInBase(), which take
// the currencies. This covers src/app — routes included — and src/components.

const UI = [join(process.cwd(), 'src', 'app'), join(process.cwd(), 'src', 'components')]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

const files = UI.flatMap((dir) => walk(dir))

describe('a screen never values a position in two currencies at once', () => {
  it('reads the UI files at all, so an empty pass is not a pass', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  // aggregatePositionValues() was the other blind function: /api/dashboard/summary
  // called it, summed dollars with pesos and answered −94%. Nothing else ever
  // called it, and it is gone; this list is where a new one would go.
  for (const blind of ['positionValuation(', 'aggregatePositionValues(']) {
    it(`leaves ${blind.slice(0, -1)} to the code that knows the currencies`, () => {
      const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(blind))

      expect(
        offenders.map((f) => f.replace(process.cwd(), '').split(String.fromCharCode(92)).join('/')),
        'value the book with positionInDisplayCurrency (screens) or valueBookInBase (routes)',
      ).toEqual([])
    })
  }
})
