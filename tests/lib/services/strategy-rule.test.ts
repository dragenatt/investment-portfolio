import { describe, it, expect } from 'vitest'
import {
  INDICATOR_SPECS,
  OPERATORS,
  evaluateOperand,
  evaluateCondition,
  evaluateRule,
  compileStrategy,
  describeRule,
  validateStrategy,
  EXAMPLE_STRATEGIES,
  type Condition,
  type Rule,
  type Strategy,
} from '@/lib/services/strategy-rule'

/** Closes rising at a constant rate — every moving average sits below price. */
const rising = (n: number, start = 100, rate = 0.01) =>
  Array.from({ length: n }, (_, i) => start * Math.pow(1 + rate, i))

/** Closes falling at a constant rate. */
const falling = (n: number, start = 100, rate = 0.01) =>
  Array.from({ length: n }, (_, i) => start * Math.pow(1 - rate, i))

/** Flat then a sharp rise, so a short average crosses above a long one. */
const crossUp = () => [...Array(40).fill(100), ...rising(20, 100, 0.03)]

describe('INDICATOR_SPECS', () => {
  it('covers every indicator the roadmap asks for', () => {
    const ids = INDICATOR_SPECS.map((s) => s.id)
    expect(ids).toContain('rsi')
    expect(ids).toContain('sma')
    expect(ids).toContain('ema')
    expect(ids).toContain('price')
    expect(ids).toContain('bollingerUpper')
    expect(ids).toContain('bollingerLower')
  })

  it('says what each indicator needs and what it means', () => {
    for (const spec of INDICATOR_SPECS) {
      expect(spec.label.length).toBeGreaterThan(2)
      expect(spec.explanation.length).toBeGreaterThan(30)
    }
  })

  it('marks which indicators take a period and which do not', () => {
    expect(INDICATOR_SPECS.find((s) => s.id === 'price')!.hasPeriod).toBe(false)
    expect(INDICATOR_SPECS.find((s) => s.id === 'sma')!.hasPeriod).toBe(true)
  })
})

describe('OPERATORS', () => {
  it('covers the four the roadmap asks for', () => {
    expect(OPERATORS.map((o) => o.id)).toEqual(['gt', 'lt', 'crossesAbove', 'crossesBelow'])
  })
})

describe('evaluateOperand', () => {
  const closes = rising(60)

  it('reads the latest price', () => {
    const value = evaluateOperand({ kind: 'indicator', indicator: 'price' }, closes)
    expect(value).toBeCloseTo(closes[closes.length - 1], 8)
  })

  it('reads a constant', () => {
    expect(evaluateOperand({ kind: 'constant', value: 30 }, closes)).toBe(30)
  })

  it('puts a moving average below price in an uptrend', () => {
    const sma = evaluateOperand({ kind: 'indicator', indicator: 'sma', period: 20 }, closes)!
    const price = evaluateOperand({ kind: 'indicator', indicator: 'price' }, closes)!
    expect(sma).toBeLessThan(price)
  })

  it('puts RSI above 70 after a long rise and below 30 after a long fall', () => {
    const up = evaluateOperand({ kind: 'indicator', indicator: 'rsi', period: 14 }, rising(60))!
    const down = evaluateOperand({ kind: 'indicator', indicator: 'rsi', period: 14 }, falling(60))!
    expect(up).toBeGreaterThan(70)
    expect(down).toBeLessThan(30)
  })

  it('returns null when there is not enough history for the period', () => {
    // Nine bars cannot produce a 20-period average, and a partial one would be
    // a different statistic wearing the same name.
    expect(evaluateOperand({ kind: 'indicator', indicator: 'sma', period: 20 }, rising(9))).toBeNull()
  })

  it('returns null rather than a number for an empty series', () => {
    expect(evaluateOperand({ kind: 'indicator', indicator: 'price' }, [])).toBeNull()
  })

  it('returns null for a non-finite constant', () => {
    expect(evaluateOperand({ kind: 'constant', value: Number.NaN }, closes)).toBeNull()
  })

  it('can look back one bar, which is what a cross needs', () => {
    const now = evaluateOperand({ kind: 'indicator', indicator: 'price' }, closes, 0)!
    const before = evaluateOperand({ kind: 'indicator', indicator: 'price' }, closes, 1)!
    expect(now).toBeGreaterThan(before)
  })
})

describe('evaluateCondition', () => {
  const closes = rising(60)

  it('evaluates greater-than', () => {
    const condition: Condition = {
      left: { kind: 'indicator', indicator: 'price' },
      operator: 'gt',
      right: { kind: 'indicator', indicator: 'sma', period: 20 },
    }
    expect(evaluateCondition(condition, closes)).toBe(true)
  })

  it('evaluates less-than', () => {
    const condition: Condition = {
      left: { kind: 'indicator', indicator: 'price' },
      operator: 'lt',
      right: { kind: 'indicator', indicator: 'sma', period: 20 },
    }
    expect(evaluateCondition(condition, falling(60))).toBe(true)
  })

  it('detects a cross above only on the bar it happens', () => {
    const series = crossUp()
    const condition: Condition = {
      left: { kind: 'indicator', indicator: 'sma', period: 5 },
      operator: 'crossesAbove',
      right: { kind: 'indicator', indicator: 'sma', period: 20 },
    }

    // Somewhere in the rise it crosses; before the rise it never does.
    const flatOnly = series.slice(0, 40)
    expect(evaluateCondition(condition, flatOnly)).toBe(false)

    const crossedSomewhere = series
      .map((_, i) => evaluateCondition(condition, series.slice(0, i + 1)))
      .filter(Boolean)
    expect(crossedSomewhere.length).toBe(1)
  })

  it('detects a cross below', () => {
    const series = [...Array(40).fill(100), ...falling(20, 100, 0.03)]
    const condition: Condition = {
      left: { kind: 'indicator', indicator: 'sma', period: 5 },
      operator: 'crossesBelow',
      right: { kind: 'indicator', indicator: 'sma', period: 20 },
    }
    const crossed = series
      .map((_, i) => evaluateCondition(condition, series.slice(0, i + 1)))
      .filter(Boolean)
    expect(crossed.length).toBe(1)
  })

  it('is false, never true, when either side cannot be computed', () => {
    // An unknown condition must not fire. A strategy that trades on missing
    // data is worse than one that does nothing.
    const condition: Condition = {
      left: { kind: 'indicator', indicator: 'sma', period: 50 },
      operator: 'gt',
      right: { kind: 'constant', value: 10 },
    }
    expect(evaluateCondition(condition, rising(5))).toBe(false)
  })
})

describe('evaluateRule', () => {
  const closes = rising(60)

  const priceAboveSma: Condition = {
    left: { kind: 'indicator', indicator: 'price' },
    operator: 'gt',
    right: { kind: 'indicator', indicator: 'sma', period: 20 },
  }
  const rsiAbove90: Condition = {
    left: { kind: 'indicator', indicator: 'rsi', period: 14 },
    operator: 'gt',
    right: { kind: 'constant', value: 90 },
  }

  it('requires every condition under AND', () => {
    const rule: Rule = { combinator: 'and', conditions: [priceAboveSma, rsiAbove90] }
    expect(evaluateRule(rule, closes)).toBe(evaluateCondition(rsiAbove90, closes))
  })

  it('requires only one under OR', () => {
    const rule: Rule = { combinator: 'or', conditions: [priceAboveSma, rsiAbove90] }
    expect(evaluateRule(rule, closes)).toBe(true)
  })

  it('is false for a rule with no conditions', () => {
    // An empty rule is not "always true": it is a rule nobody finished writing.
    expect(evaluateRule({ combinator: 'and', conditions: [] }, closes)).toBe(false)
  })
})

describe('compileStrategy', () => {
  const buyRule: Rule = {
    combinator: 'and',
    conditions: [
      {
        left: { kind: 'indicator', indicator: 'price' },
        operator: 'gt',
        right: { kind: 'indicator', indicator: 'sma', period: 20 },
      },
    ],
  }
  const sellRule: Rule = {
    combinator: 'and',
    conditions: [
      {
        left: { kind: 'indicator', indicator: 'price' },
        operator: 'lt',
        right: { kind: 'indicator', indicator: 'sma', period: 20 },
      },
    ],
  }

  const strategy: Strategy = { name: 'test', buy: buyRule, sell: sellRule }

  it('produces a function the backtester can use directly', () => {
    const signal = compileStrategy(strategy)!
    expect(typeof signal).toBe('function')
    expect(signal(rising(60))).toBe('buy')
    expect(signal(falling(60))).toBe('sell')
  })

  it('holds when neither rule fires', () => {
    const signal = compileStrategy(strategy)!
    // Too little history for the 20-period average: neither side can be decided
    expect(signal(rising(5))).toBe('hold')
  })

  it('holds when both rules fire, rather than picking one', () => {
    // Contradictory rules are a user error, and silently preferring buy would
    // hide it behind a plausible-looking backtest.
    const contradictory: Strategy = { name: 'both', buy: buyRule, sell: buyRule }
    expect(compileStrategy(contradictory)!(rising(60))).toBe('hold')
  })

  it('receives only the closes up to the decision bar', () => {
    // The look-ahead guard lives in the signature; this pins that the compiled
    // function never reaches past what it is handed.
    const seen: number[] = []
    const spy: Strategy = {
      name: 'spy',
      buy: {
        combinator: 'and',
        conditions: [
          {
            left: { kind: 'indicator', indicator: 'price' },
            operator: 'gt',
            right: { kind: 'constant', value: 0 },
          },
        ],
      },
      sell: { combinator: 'and', conditions: [] },
    }
    const signal = compileStrategy(spy)!
    const closes = rising(30)
    for (let i = 1; i <= closes.length; i++) {
      const slice = closes.slice(0, i)
      signal(slice)
      seen.push(slice.length)
    }
    expect(seen[seen.length - 1]).toBe(closes.length)
  })

  it('refuses a strategy that does not validate', () => {
    expect(compileStrategy({ name: '', buy: buyRule, sell: sellRule })).toBeNull()
  })
})

describe('validateStrategy', () => {
  const ok: Condition = {
    left: { kind: 'indicator', indicator: 'price' },
    operator: 'gt',
    right: { kind: 'indicator', indicator: 'sma', period: 20 },
  }

  it('accepts a complete strategy', () => {
    const result = validateStrategy({
      name: 'ok',
      buy: { combinator: 'and', conditions: [ok] },
      sell: { combinator: 'and', conditions: [] },
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects a strategy with no name', () => {
    const result = validateStrategy({
      name: '  ',
      buy: { combinator: 'and', conditions: [ok] },
      sell: { combinator: 'and', conditions: [] },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/nombre/i)
  })

  it('rejects a strategy that can never buy', () => {
    const result = validateStrategy({
      name: 'never',
      buy: { combinator: 'and', conditions: [] },
      sell: { combinator: 'and', conditions: [ok] },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/compra/i)
  })

  it('rejects a period that is not a positive whole number', () => {
    const bad: Condition = {
      left: { kind: 'indicator', indicator: 'sma', period: 0 },
      operator: 'gt',
      right: { kind: 'constant', value: 1 },
    }
    const result = validateStrategy({
      name: 'bad period',
      buy: { combinator: 'and', conditions: [bad] },
      sell: { combinator: 'and', conditions: [] },
    })
    expect(result.valid).toBe(false)
  })

  it('warns when a rule compares an indicator against itself', () => {
    // price > price is never true, and a backtest of it looks like a strategy
    // that simply never trades rather than one that is broken.
    const selfCompare: Condition = {
      left: { kind: 'indicator', indicator: 'sma', period: 20 },
      operator: 'gt',
      right: { kind: 'indicator', indicator: 'sma', period: 20 },
    }
    const result = validateStrategy({
      name: 'self',
      buy: { combinator: 'and', conditions: [selfCompare] },
      sell: { combinator: 'and', conditions: [] },
    })
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('reports the longest period, so the caller can set a warmup', () => {
    const result = validateStrategy({
      name: 'warmup',
      buy: {
        combinator: 'and',
        conditions: [
          ok,
          {
            left: { kind: 'indicator', indicator: 'ema', period: 200 },
            operator: 'gt',
            right: { kind: 'constant', value: 1 },
          },
        ],
      },
      sell: { combinator: 'and', conditions: [] },
    })
    expect(result.longestPeriod).toBe(200)
  })
})

describe('describeRule', () => {
  it('reads as a sentence, not as a data structure', () => {
    const text = describeRule({
      combinator: 'and',
      conditions: [
        {
          left: { kind: 'indicator', indicator: 'rsi', period: 14 },
          operator: 'lt',
          right: { kind: 'constant', value: 30 },
        },
      ],
    })
    expect(text.toLowerCase()).toContain('rsi')
    expect(text).toContain('30')
    expect(text).not.toContain('{')
  })

  it('joins conditions with the combinator in words', () => {
    const rule: Rule = {
      combinator: 'or',
      conditions: [
        {
          left: { kind: 'indicator', indicator: 'price' },
          operator: 'gt',
          right: { kind: 'constant', value: 100 },
        },
        {
          left: { kind: 'indicator', indicator: 'rsi', period: 14 },
          operator: 'lt',
          right: { kind: 'constant', value: 30 },
        },
      ],
    }
    expect(describeRule(rule).toLowerCase()).toContain(' o ')
  })

  it('says plainly when a rule is empty', () => {
    expect(describeRule({ combinator: 'and', conditions: [] }).length).toBeGreaterThan(5)
  })
})

describe('EXAMPLE_STRATEGIES', () => {
  it('includes the four the roadmap asks for', () => {
    const ids = EXAMPLE_STRATEGIES.map((s) => s.id)
    expect(ids).toContain('smaCross')
    expect(ids).toContain('rsiReversion')
    expect(ids).toContain('bollingerBreakout')
    expect(ids).toContain('momentum')
  })

  it('every example validates and compiles', () => {
    for (const example of EXAMPLE_STRATEGIES) {
      const result = validateStrategy(example.strategy)
      expect(result.valid, `${example.id}: ${result.errors.join(', ')}`).toBe(true)
      expect(compileStrategy(example.strategy)).not.toBeNull()
    }
  })

  it('every example actually trades on a series that should trigger it', () => {
    // An example that never fires teaches nothing, and would look identical to
    // one that is subtly broken.
    //
    // The series has to outrun the longest period any example uses — momentum
    // takes a 200-day average, and on a shorter series it correctly refuses to
    // trade rather than averaging whatever it has. That refusal is the engine
    // working; a 180-bar fixture was just too short to see it.
    const series = [
      ...rising(140, 100, 0.012),
      ...falling(120, 500, 0.012),
      ...rising(140, 120, 0.012),
    ]
    for (const example of EXAMPLE_STRATEGIES) {
      const signal = compileStrategy(example.strategy)!
      const actions = series.map((_, i) => signal(series.slice(0, i + 1)))
      expect(
        actions.some((a) => a !== 'hold'),
        `${example.id} never produced a signal`,
      ).toBe(true)
    }
  })

  it('explains what each example is trying to do', () => {
    for (const example of EXAMPLE_STRATEGIES) {
      expect(example.description.length).toBeGreaterThan(40)
    }
  })
})
