import { describe, it, expect } from 'vitest'
import {
  expectedProgressAt,
  goalProgress,
  classifyPace,
  type GoalSnapshot,
} from '@/lib/services/goals'

const goal: GoalSnapshot = {
  targetAmount: 1_000_000,
  startDate: '2025-01-01',
  targetDate: '2035-01-01',
  startingCapital: 50_000,
  plannedMonthlyContribution: 5_000,
  expectedAnnualReturn: 0.07,
}

describe('expectedProgressAt', () => {
  it('is the starting capital at the very beginning', () => {
    expect(expectedProgressAt(goal, 0)).toBeCloseTo(50_000, 2)
  })

  it('reaches the plan projection at the end of the horizon', () => {
    // 50k compounding for 10 years plus 5k a month
    const atEnd = expectedProgressAt(goal, 120)
    expect(atEnd).toBeGreaterThan(900_000)
  })

  it('is NOT linear — compounding is back-loaded', () => {
    // The whole reason this function exists. A straight line from start to
    // finish would call every investor "behind" for most of the horizon.
    const half = expectedProgressAt(goal, 60)
    const end = expectedProgressAt(goal, 120)
    const linearHalf = 50_000 + (end - 50_000) / 2
    expect(half).toBeLessThan(linearHalf)
  })

  it('grows monotonically with a positive expected return', () => {
    let previous = -1
    for (const month of [0, 12, 24, 60, 120]) {
      const value = expectedProgressAt(goal, month)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })

  it('handles a plan with no contributions', () => {
    const lump = { ...goal, plannedMonthlyContribution: 0 }
    expect(expectedProgressAt(lump, 120)).toBeCloseTo(50_000 * Math.pow(1.07, 10), 0)
  })

  it('handles a zero expected return as plain saving', () => {
    const saving = { ...goal, expectedAnnualReturn: 0 }
    expect(expectedProgressAt(saving, 12)).toBeCloseTo(50_000 + 5_000 * 12, 2)
  })

  it('never returns a non-finite number', () => {
    expect(Number.isFinite(expectedProgressAt({ ...goal, expectedAnnualReturn: -2 }, 60))).toBe(true)
  })
})

describe('goalProgress', () => {
  const asOf = new Date('2030-01-01') // exactly 5 years in, halfway

  it('measures how far along the money is', () => {
    const progress = goalProgress(goal, { currentValue: 400_000, contributedToDate: 350_000 }, asOf)!
    expect(progress.currentValue).toBe(400_000)
    expect(progress.progressPct).toBeCloseTo(40, 6)
  })

  it('measures how far along the clock is, separately', () => {
    const progress = goalProgress(goal, { currentValue: 400_000, contributedToDate: 350_000 }, asOf)!
    expect(progress.timeElapsedPct).toBeCloseTo(50, 0)
    expect(progress.monthsElapsed).toBe(60)
    expect(progress.monthsRemaining).toBe(60)
  })

  it('compares actual against the compounding curve, not a straight line', () => {
    const progress = goalProgress(goal, { currentValue: 400_000, contributedToDate: 350_000 }, asOf)!
    expect(progress.expectedValue).toBeCloseTo(expectedProgressAt(goal, 60), 2)
    expect(progress.expectedValue).toBeLessThan(500_000)
  })

  it('reports the gap against plan in money and in percent', () => {
    const expected = expectedProgressAt(goal, 60)
    const progress = goalProgress(goal, { currentValue: expected + 20_000, contributedToDate: 350_000 }, asOf)!
    expect(progress.deviation).toBeCloseTo(20_000, 2)
    expect(progress.deviationPct).toBeGreaterThan(0)
  })

  it('compares contributions actually made against those planned', () => {
    const progress = goalProgress(goal, { currentValue: 400_000, contributedToDate: 280_000 }, asOf)!
    // Planned: 50k start + 60 x 5k = 350k
    expect(progress.plannedContributedToDate).toBeCloseTo(350_000, 2)
    expect(progress.contributionShortfall).toBeCloseTo(70_000, 2)
  })

  it('reports no shortfall when contributions are on plan', () => {
    const progress = goalProgress(goal, { currentValue: 400_000, contributedToDate: 350_000 }, asOf)!
    expect(progress.contributionShortfall).toBeCloseTo(0, 2)
  })

  it('says the goal is reached once the value is there', () => {
    const progress = goalProgress(goal, { currentValue: 1_100_000, contributedToDate: 350_000 }, asOf)!
    expect(progress.reached).toBe(true)
    expect(progress.progressPct).toBeGreaterThanOrEqual(100)
  })

  it('caps progress at 100 rather than reporting 340% of a goal', () => {
    const progress = goalProgress(goal, { currentValue: 3_400_000, contributedToDate: 350_000 }, asOf)!
    expect(progress.progressPct).toBe(100)
    expect(progress.currentValue).toBe(3_400_000)
  })

  it('handles a date before the goal started', () => {
    const progress = goalProgress(goal, { currentValue: 50_000, contributedToDate: 50_000 }, new Date('2024-06-01'))!
    expect(progress.monthsElapsed).toBe(0)
    expect(progress.timeElapsedPct).toBe(0)
  })

  it('handles a date past the target', () => {
    const progress = goalProgress(goal, { currentValue: 800_000, contributedToDate: 650_000 }, new Date('2040-01-01'))!
    expect(progress.monthsRemaining).toBe(0)
    expect(progress.timeElapsedPct).toBe(100)
  })

  it('refuses a goal whose dates make no sense', () => {
    expect(goalProgress({ ...goal, targetDate: '2020-01-01' }, { currentValue: 1, contributedToDate: 1 }, asOf)).toBeNull()
    expect(goalProgress({ ...goal, targetAmount: 0 }, { currentValue: 1, contributedToDate: 1 }, asOf)).toBeNull()
  })

  it('never emits a non-finite number', () => {
    const progress = goalProgress(goal, { currentValue: 0, contributedToDate: 0 }, asOf)!
    for (const value of [progress.progressPct, progress.deviation, progress.deviationPct]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('is deterministic', () => {
    const actual = { currentValue: 400_000, contributedToDate: 350_000 }
    expect(goalProgress(goal, actual, asOf)).toEqual(goalProgress(goal, actual, asOf))
  })
})

describe('classifyPace', () => {
  it('calls a book comfortably above plan ahead', () => {
    expect(classifyPace(15).pace).toBe('ahead')
  })

  it('calls a book comfortably below plan behind', () => {
    expect(classifyPace(-15).pace).toBe('behind')
  })

  it('calls a small gap on track — a plan is not a timetable', () => {
    expect(classifyPace(3).pace).toBe('on-track')
    expect(classifyPace(-3).pace).toBe('on-track')
  })

  it('explains what being behind does and does not mean', () => {
    const behind = classifyPace(-25)
    expect(behind.message.length).toBeGreaterThan(40)
    // Being behind a projection is not failure; the message must not say it is
    expect(behind.message).not.toMatch(/fracas|fall[oó]|perdiste/i)
  })

  it('explains that being ahead is not a reason to relax', () => {
    expect(classifyPace(30).message.length).toBeGreaterThan(40)
  })

  it('handles a non-finite deviation', () => {
    expect(classifyPace(Number.NaN).pace).toBe('unknown')
  })
})
