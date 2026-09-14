// Background jobs (C1) — the lifecycle, as pure functions. No I/O.
//
// Monte Carlo, backtesting, factor regressions, optimisation and stress tests
// each fetch price histories and run thousands of iterations. Computed inside
// the request, a slow provider holds the browser's connection open for the
// whole calculation and a platform timeout loses the work entirely.
//
// A job decouples the two: the request records the work and returns a job id
// at once, the calculation runs after the response, and the result is read by
// polling the job's status. Everything below decides what state a job is in and
// what should happen to it next; src/lib/jobs/runner.ts does the reading and
// writing.
//
// The one invariant: no job stays `processing` forever. A job carries a
// deadline. Whoever next looks at it — a status poll, a request for the same
// work, the nightly sweep — and finds the deadline passed either retries it or
// fails it with a timeout. There is no path that leaves it waiting on a worker
// that no longer exists.

import { createHash } from 'node:crypto'

export const JOB_KINDS = ['monteCarlo', 'backtest', 'factors', 'optimization', 'stress'] as const
export type JobKind = (typeof JOB_KINDS)[number]

/** processing: an attempt is running. retrying: the last attempt failed and another is due. */
export type JobStatus = 'processing' | 'retrying' | 'completed' | 'failed'
export type JobErrorKind = 'timeout' | 'exception'

export type JobRecord = {
  id: string
  kind: JobKind
  status: JobStatus
  attempts: number
  max_attempts: number
  /** When the current attempt must have finished, or when a retry becomes due. */
  deadline_at: string
  completed_at: string | null
  error: string | null
  error_kind: JobErrorKind | null
}

/**
 * The function running a job, in seconds — the `maxDuration` of the routes that
 * call `after()`. Every timeout below sits under it, or the platform would kill
 * the attempt before the timeout could record it.
 */
export const JOB_MAX_DURATION_SECONDS = 60

export type JobPolicy = {
  timeoutMs: number
  maxAttempts: number
  /** How long a completed result is reused. Matches the cache TTL of the synchronous route. */
  resultTtlSeconds: number
}

export const JOB_POLICY: Record<JobKind, JobPolicy> = {
  monteCarlo: { timeoutMs: 30_000, maxAttempts: 3, resultTtlSeconds: 300 },
  backtest: { timeoutMs: 45_000, maxAttempts: 3, resultTtlSeconds: 3600 },
  factors: { timeoutMs: 45_000, maxAttempts: 3, resultTtlSeconds: 1800 },
  optimization: { timeoutMs: 45_000, maxAttempts: 3, resultTtlSeconds: 900 },
  // Several decades of history per holding, from a slow provider.
  stress: { timeoutMs: 50_000, maxAttempts: 2, resultTtlSeconds: 3600 },
}

export function isJobKind(value: unknown): value is JobKind {
  return typeof value === 'string' && (JOB_KINDS as readonly string[]).includes(value)
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed'
}

// ─── Parameters ─────────────────────────────────────────────────────────────

const MC_DEFAULT_WEEKS = 52
const MC_MIN_WEEKS = 4
const MC_MAX_WEEKS = 260
const BACKTEST_DEFAULT_COST = 0.1

export type JobParams = Record<string, number>

/**
 * The parameters a kind accepts, validated and clamped exactly as its
 * synchronous route does, with everything else dropped. What is stored and
 * hashed is this, so two requests that mean the same thing share one job.
 */
export function normaliseJobParams(kind: JobKind, raw: unknown): JobParams {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  switch (kind) {
    case 'monteCarlo': {
      const weeks = Number(input.weeks)
      if (!Number.isFinite(weeks)) return { weeks: MC_DEFAULT_WEEKS }
      return { weeks: Math.min(Math.max(Math.floor(weeks), MC_MIN_WEEKS), MC_MAX_WEEKS) }
    }
    case 'backtest': {
      const cost = Number(input.costPct)
      return { costPct: Number.isFinite(cost) && cost >= 0 && cost <= 5 ? cost : BACKTEST_DEFAULT_COST }
    }
    default:
      return {}
  }
}

/** The identity of a piece of work: same user, kind, portfolio and parameters. */
export function jobKey(userId: string, kind: JobKind, portfolioId: string, params: JobParams): string {
  const stableParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  return createHash('sha256').update(`${userId}|${kind}|${portfolioId}|${stableParams}`).digest('hex')
}

// ─── Transitions ────────────────────────────────────────────────────────────

export type Reconciliation =
  | { action: 'none' }
  | { action: 'retry' }
  | { action: 'fail'; errorKind: 'timeout' }

/**
 * What to do with a job someone is looking at.
 *
 * A job past its deadline that is not finished has nobody working on it: the
 * attempt was killed with its invocation, or a retry fell due and nobody
 * dispatched it. It is retried while attempts remain and failed otherwise.
 */
export function reconcileJob(job: JobRecord, now: number): Reconciliation {
  if (isTerminal(job.status)) return { action: 'none' }
  if (Date.parse(job.deadline_at) > now) return { action: 'none' }
  return job.attempts < job.max_attempts ? { action: 'retry' } : { action: 'fail', errorKind: 'timeout' }
}

/** Backoff before retry n: 2s, 4s, 8s, capped at 20s. */
export function backoffMs(attempt: number): number {
  return Math.min(20_000, 2_000 * 2 ** Math.max(0, attempt - 1))
}

export type FailureOutcome = {
  status: 'retrying' | 'failed'
  error: string
  error_kind: JobErrorKind
  deadline_at: string
}

/** The state a job moves to when the attempt just made did not complete. */
export function outcomeOfFailure(
  job: JobRecord,
  errorKind: JobErrorKind,
  error: string,
  now: number,
): FailureOutcome {
  const retry = job.attempts < job.max_attempts
  return {
    status: retry ? 'retrying' : 'failed',
    error,
    error_kind: errorKind,
    deadline_at: new Date(now + (retry ? backoffMs(job.attempts) : 0)).toISOString(),
  }
}

/**
 * Whether a request for the same work can be answered by this job.
 *
 * A fresh result is reused; so is an attempt still inside its deadline, which a
 * second tab joins rather than duplicating. A stale in-flight job is not — it
 * has to be reconciled first — and a failure is never handed back as an answer.
 */
export function isReusable(job: JobRecord, now: number): boolean {
  if (job.status === 'failed') return false
  if (job.status === 'completed') {
    if (!job.completed_at) return false
    return now - Date.parse(job.completed_at) < JOB_POLICY[job.kind].resultTtlSeconds * 1000
  }
  return Date.parse(job.deadline_at) > now
}

// ─── One attempt ────────────────────────────────────────────────────────────

export type AttemptOutcome =
  | { ok: true; result: unknown }
  | { ok: false; errorKind: JobErrorKind; error: string }

/**
 * Run a calculation against its timeout.
 *
 * The timeout does not cancel the work — JavaScript cannot — but it stops the
 * job waiting on it: the attempt is recorded as timed out, and whatever the
 * calculation produces afterwards is discarded. The result must survive a JSON
 * round trip, because that is how it is stored; a value that would be silently
 * mangled on the way into jsonb is reported as a failure instead.
 */
export async function runAttempt(compute: () => Promise<unknown>, timeoutMs: number): Promise<AttemptOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<AttemptOutcome>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, errorKind: 'timeout', error: `El calculo no termino en ${timeoutMs} ms.` }),
      timeoutMs,
    )
  })

  const work = (async (): Promise<AttemptOutcome> => {
    try {
      const result = await compute()
      return { ok: true, result: JSON.parse(JSON.stringify(result ?? null)) }
    } catch (thrown) {
      return {
        ok: false,
        errorKind: 'exception',
        error: thrown instanceof Error ? thrown.message : String(thrown),
      }
    }
  })()

  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}
