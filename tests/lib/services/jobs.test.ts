import { describe, it, expect } from 'vitest'
import {
  JOB_KINDS,
  JOB_POLICY,
  JOB_MAX_DURATION_SECONDS,
  JOB_COMPLETION_RESERVE_MS,
  JOB_MIN_ATTEMPT_MS,
  attemptBudgetMs,
  jobKey,
  normaliseJobParams,
  reconcileJob,
  outcomeOfFailure,
  isReusable,
  runAttempt,
  isTerminal,
  type JobRecord,
} from '@/lib/services/jobs'

const NOW = Date.parse('2026-09-13T12:00:00Z')

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    kind: 'monteCarlo',
    status: 'processing',
    attempts: 1,
    max_attempts: 3,
    deadline_at: new Date(NOW + 10_000).toISOString(),
    completed_at: null,
    error: null,
    error_kind: null,
    ...overrides,
  }
}

describe('JOB_POLICY', () => {
  it('covers the five heavy calculations C1 names', () => {
    expect([...JOB_KINDS].sort()).toEqual(['backtest', 'factors', 'monteCarlo', 'optimization', 'stress'])
  })

  it('gives every kind a timeout that fits inside the function it runs in', () => {
    // A timeout longer than the platform's max duration never fires: the
    // invocation is killed first and the job is left for reconciliation.
    for (const kind of JOB_KINDS) {
      const policy = JOB_POLICY[kind]
      expect(policy.timeoutMs).toBeGreaterThan(0)
      expect(policy.timeoutMs).toBeLessThan(JOB_MAX_DURATION_SECONDS * 1000)
      expect(policy.maxAttempts).toBeGreaterThanOrEqual(2)
      expect(policy.maxAttempts).toBeLessThanOrEqual(5)
      expect(policy.resultTtlSeconds).toBeGreaterThan(0)
    }
  })
})

describe('attemptBudgetMs', () => {
  // The policy timeouts were written as if the attempt began the moment the
  // function did. It does not: the request authenticates, checks the portfolio
  // against RLS and writes a job row first, and 50 seconds of stress test on
  // top of that is what produced "Task timed out after 60 seconds" in
  // production on 2026-09-18 — the platform killing the invocation while the
  // outcome was being written.
  it('never lets an attempt outlast the invocation it runs in', () => {
    for (const kind of JOB_KINDS) {
      for (const elapsed of [0, 1_000, 5_000, 20_000]) {
        const budget = attemptBudgetMs(kind, elapsed)
        expect(budget + elapsed + JOB_COMPLETION_RESERVE_MS).toBeLessThanOrEqual(
          JOB_MAX_DURATION_SECONDS * 1000,
        )
      }
    }
  })

  it('gives a fresh invocation what the policy asks for', () => {
    // 50s of stress + 5s reserve still fits in 60, so the policy stands.
    expect(attemptBudgetMs('stress', 0)).toBe(JOB_POLICY.stress.timeoutMs)
    expect(attemptBudgetMs('monteCarlo', 3_000)).toBe(JOB_POLICY.monteCarlo.timeoutMs)
  })

  it('shortens the attempt when the request has already spent time', () => {
    expect(attemptBudgetMs('stress', 10_000)).toBe(45_000)
    expect(attemptBudgetMs('stress', 20_000)).toBe(35_000)
  })

  it('goes below the useful minimum rather than pretending, when nothing is left', () => {
    expect(attemptBudgetMs('stress', 58_000)).toBeLessThan(JOB_MIN_ATTEMPT_MS)
    expect(attemptBudgetMs('backtest', 70_000)).toBeLessThan(0)
  })

  it('treats a negative elapsed time as none at all', () => {
    expect(attemptBudgetMs('factors', -5_000)).toBe(JOB_POLICY.factors.timeoutMs)
  })
})

describe('normaliseJobParams', () => {
  it('clamps the Monte Carlo horizon the way the route does', () => {
    expect(normaliseJobParams('monteCarlo', { weeks: 52 })).toEqual({ weeks: 52 })
    expect(normaliseJobParams('monteCarlo', { weeks: 9999 })).toEqual({ weeks: 260 })
    expect(normaliseJobParams('monteCarlo', { weeks: 1 })).toEqual({ weeks: 4 })
    expect(normaliseJobParams('monteCarlo', {})).toEqual({ weeks: 52 })
    expect(normaliseJobParams('monteCarlo', { weeks: 'abc' })).toEqual({ weeks: 52 })
  })

  it('defaults the backtest cost and refuses a nonsense one', () => {
    expect(normaliseJobParams('backtest', {})).toEqual({ costPct: 0.1 })
    expect(normaliseJobParams('backtest', { costPct: 0.25 })).toEqual({ costPct: 0.25 })
    expect(normaliseJobParams('backtest', { costPct: -1 })).toEqual({ costPct: 0.1 })
  })

  it('takes no parameters for the kinds that have none, and drops anything sent', () => {
    for (const kind of ['factors', 'optimization', 'stress'] as const) {
      expect(normaliseJobParams(kind, { injected: 'x' })).toEqual({})
    }
  })
})

describe('jobKey', () => {
  it('is stable regardless of the order parameters arrive in', () => {
    expect(jobKey('u1', 'backtest', 'p1', { costPct: 0.1, x: 1 })).toBe(
      jobKey('u1', 'backtest', 'p1', { x: 1, costPct: 0.1 }),
    )
  })

  it('differs by user, kind, portfolio and parameters', () => {
    const base = jobKey('u1', 'monteCarlo', 'p1', { weeks: 52 })
    expect(jobKey('u2', 'monteCarlo', 'p1', { weeks: 52 })).not.toBe(base)
    expect(jobKey('u1', 'factors', 'p1', { weeks: 52 })).not.toBe(base)
    expect(jobKey('u1', 'monteCarlo', 'p2', { weeks: 52 })).not.toBe(base)
    expect(jobKey('u1', 'monteCarlo', 'p1', { weeks: 26 })).not.toBe(base)
  })
})

describe('reconcileJob — nothing stays processing forever', () => {
  it('leaves an in-flight job alone before its deadline', () => {
    expect(reconcileJob(job(), NOW)).toEqual({ action: 'none' })
  })

  it('retries a job whose deadline passed while attempts remain', () => {
    // The invocation running it was killed, or never started. Either way no
    // one is working on it.
    const stale = job({ deadline_at: new Date(NOW - 1).toISOString(), attempts: 1 })
    expect(reconcileJob(stale, NOW)).toEqual({ action: 'retry' })
  })

  it('also dispatches a job waiting in retrying once its deadline passes', () => {
    const waiting = job({ status: 'retrying', deadline_at: new Date(NOW - 1).toISOString() })
    expect(reconcileJob(waiting, NOW)).toEqual({ action: 'retry' })
  })

  it('fails a job with a timeout once the attempts are used up', () => {
    const exhausted = job({ deadline_at: new Date(NOW - 1).toISOString(), attempts: 3 })
    expect(reconcileJob(exhausted, NOW)).toEqual({ action: 'fail', errorKind: 'timeout' })
  })

  it('never touches a finished job', () => {
    const past = new Date(NOW - 60_000).toISOString()
    expect(reconcileJob(job({ status: 'completed', deadline_at: past }), NOW)).toEqual({ action: 'none' })
    expect(reconcileJob(job({ status: 'failed', deadline_at: past }), NOW)).toEqual({ action: 'none' })
  })
})

describe('outcomeOfFailure', () => {
  it('schedules a retry while attempts remain', () => {
    const outcome = outcomeOfFailure(job({ attempts: 1 }), 'exception', 'boom', NOW)
    expect(outcome.status).toBe('retrying')
    expect(outcome.error_kind).toBe('exception')
    expect(outcome.error).toBe('boom')
    // Due immediately, with a short backoff so a failing dependency is not hammered.
    expect(Date.parse(outcome.deadline_at)).toBeGreaterThan(NOW)
    expect(Date.parse(outcome.deadline_at)).toBeLessThanOrEqual(NOW + 30_000)
  })

  it('fails for good on the last attempt', () => {
    const outcome = outcomeOfFailure(job({ attempts: 3 }), 'timeout', 'timeout', NOW)
    expect(outcome.status).toBe('failed')
    expect(outcome.error_kind).toBe('timeout')
  })

  it('backs off longer on each attempt', () => {
    const first = Date.parse(outcomeOfFailure(job({ attempts: 1 }), 'exception', 'x', NOW).deadline_at)
    const second = Date.parse(outcomeOfFailure(job({ attempts: 2, max_attempts: 4 }), 'exception', 'x', NOW).deadline_at)
    expect(second).toBeGreaterThan(first)
  })
})

describe('isReusable', () => {
  it('reuses a completed result while it is fresh', () => {
    const done = job({ status: 'completed', completed_at: new Date(NOW - 60_000).toISOString() })
    expect(isReusable(done, NOW)).toBe(true)
  })

  it('does not reuse a result older than the kind allows', () => {
    const ttl = JOB_POLICY.monteCarlo.resultTtlSeconds * 1000
    const old = job({ status: 'completed', completed_at: new Date(NOW - ttl - 1).toISOString() })
    expect(isReusable(old, NOW)).toBe(false)
  })

  it('joins a job already in flight instead of starting a second one', () => {
    expect(isReusable(job(), NOW)).toBe(true)
  })

  it('does not join a stale in-flight job, which has to be reconciled first', () => {
    expect(isReusable(job({ deadline_at: new Date(NOW - 1).toISOString() }), NOW)).toBe(false)
  })

  it('never reuses a failure', () => {
    expect(isReusable(job({ status: 'failed' }), NOW)).toBe(false)
  })
})

describe('isTerminal', () => {
  it('is true only for completed and failed', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('processing')).toBe(false)
    expect(isTerminal('retrying')).toBe(false)
  })
})

describe('runAttempt', () => {
  it('reports a completed result', async () => {
    const outcome = await runAttempt(async () => ({ ok: 1 }), 1000)
    expect(outcome).toEqual({ ok: true, result: { ok: 1 } })
  })

  it('reports an exception with its message', async () => {
    const outcome = await runAttempt(async () => {
      throw new Error('provider down')
    }, 1000)
    expect(outcome).toEqual({ ok: false, errorKind: 'exception', error: 'provider down' })
  })

  it('times out a calculation that does not finish', async () => {
    const outcome = await runAttempt(() => new Promise(() => {}), 20)
    expect(outcome).toEqual({ ok: false, errorKind: 'timeout', error: expect.stringMatching(/20 ?ms/) })
  })

  it('refuses a result that is not JSON-serialisable rather than storing half of it', async () => {
    const outcome = await runAttempt(async () => ({ value: BigInt(1) }), 1000)
    expect(outcome.ok).toBe(false)
  })
})
