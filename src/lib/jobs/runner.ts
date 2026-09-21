// Background job runner (C1) — the reads and writes around jobs.ts.
//
// Every state change is a conditional update on the row it read, so two
// processes looking at the same job — two status polls, a poll and the runner
// finishing — cannot both claim the next attempt, and a late-finishing attempt
// cannot overwrite a newer one.
//
// Jobs are written with the service role only. The calculation itself runs
// with the USER'S client, so row-level security decides what it can read,
// exactly as it did when the calculation ran inside the request.

import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import {
  JOB_POLICY,
  JOB_MIN_ATTEMPT_MS,
  attemptBudgetMs,
  jobKey,
  reconcileJob,
  isReusable,
  outcomeOfFailure,
  runAttempt,
  type JobKind,
  type JobParams,
  type JobRecord,
  type JobStatus,
  type JobErrorKind,
} from '@/lib/services/jobs'
import { markServed } from '@/lib/services/result-metadata'
import { deliverNotifications, jobFinishedNotification, type NotifiedJob } from '@/lib/services/notifications'
import { computeMonteCarlo } from './kinds/monte-carlo'
import { computeBacktest } from './kinds/backtest'
import { computeFactors } from './kinds/factors'
import { computeOptimization } from './kinds/optimization'
import { computeStress } from './kinds/stress'

export type JobRow = JobRecord & {
  user_id: string
  portfolio_id: string
  params: JobParams
  job_key: string
  result: unknown
  created_at: string
  updated_at: string
}

const COMPUTE: Record<JobKind, (supabase: SupabaseClient, pid: string, params: JobParams) => Promise<unknown>> = {
  monteCarlo: (s, pid, p) => computeMonteCarlo(s, pid, { weeks: p.weeks }),
  backtest: (s, pid, p) => computeBacktest(s, pid, { costPct: p.costPct }),
  factors: (s, pid) => computeFactors(s, pid, {}),
  // Job params are numbers, so the box limits travel and sector caps — a map —
  // do not. The synchronous route takes all three; a background run that needs
  // caps will need the params type widened first.
  optimization: (s, pid, p) => computeOptimization(s, pid, { minWeight: p.minWeight, maxWeight: p.maxWeight }),
  stress: (s, pid) => computeStress(s, pid, {}),
}

/** How each job kind is named in the inbox. */
const NOTIFIED_AS: Record<JobKind, NotifiedJob> = {
  monteCarlo: 'montecarlo',
  backtest: 'backtest',
  factors: 'factors',
  optimization: 'optimisation',
  stress: 'stress_test',
}

/**
 * How long a job must have run before its SUCCESS is worth a notification.
 *
 * Opening the analysis page starts several jobs that finish in seconds while
 * the reader watches the results appear; announcing each one put three
 * "terminó" items in the inbox for calculations already on screen. A job that
 * ran longer than this may have outlived the tab that asked for it. Failures
 * are always announced — a result that never arrives is news either way.
 */
export const ANNOUNCE_SUCCESS_AFTER_MS = 30_000

/** Whether a job's success is news, or just the thing on screen. */
export function successIsNews(createdAt: string, finishedAt: number): boolean {
  const started = Date.parse(createdAt)
  return Number.isFinite(started) && finishedAt - started >= ANNOUNCE_SUCCESS_AFTER_MS
}

/**
 * Tell the user a job ended, once. Called only when this process's conditional
 * write is the one that finished the job, so a late attempt that changed
 * nothing does not announce anything either. Never throws.
 */
async function announce(admin: SupabaseClient, job: JobRow, succeeded: boolean): Promise<void> {
  try {
    await deliverNotifications(
      [jobFinishedNotification(job.user_id, job.portfolio_id, NOTIFIED_AS[job.kind], succeeded)],
      { writer: admin },
    )
  } catch (err) {
    console.error('[jobs] notification failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Slack between the attempt's own timeout and the deadline others act on, so a
 * poll never reconciles an attempt that is about to record its timeout itself.
 */
const DEADLINE_GRACE_MS = 5_000

/** Stale unfinished jobs older than this past their deadline are failed by the sweep. */
const SWEEP_AFTER_MS = 60 * 60 * 1000
/** Finished jobs are kept this long, then deleted. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

const TABLE = 'analytics_jobs'

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function attemptDeadline(kind: JobKind, now: number): string {
  return iso(now + JOB_POLICY[kind].timeoutMs + DEADLINE_GRACE_MS)
}

/**
 * Move a job to its next attempt, if nobody else has.
 *
 * Conditional on the row being unchanged since it was read. Returns the claimed
 * row, or null when another process got there first — in which case that
 * process runs the attempt and this one does nothing.
 */
async function claimNextAttempt(admin: SupabaseClient, job: JobRow, now: number): Promise<JobRow | null> {
  if (job.attempts >= job.max_attempts) return null
  const { data } = await admin
    .from(TABLE)
    .update({
      status: 'processing' satisfies JobStatus,
      attempts: job.attempts + 1,
      deadline_at: attemptDeadline(job.kind, now),
      updated_at: iso(now),
    })
    .eq('id', job.id)
    .eq('updated_at', job.updated_at)
    .in('status', ['processing', 'retrying'])
    .select('*')
    .maybeSingle()
  return (data as JobRow | null) ?? null
}

async function markTimedOut(admin: SupabaseClient, job: JobRow, now: number): Promise<JobRow> {
  const { data } = await admin
    .from(TABLE)
    .update({
      status: 'failed' satisfies JobStatus,
      error: `Se agotaron los ${job.max_attempts} intentos sin que el cálculo terminara.`,
      error_kind: 'timeout' satisfies JobErrorKind,
      updated_at: iso(now),
    })
    .eq('id', job.id)
    .eq('updated_at', job.updated_at)
    .in('status', ['processing', 'retrying'])
    .select('*')
    .maybeSingle()
  if (data) await announce(admin, data as JobRow, false)
  return (data as JobRow | null) ?? job
}

export type Dispatch = { job: JobRow; run: boolean }

/**
 * Bring a job up to date before anyone is told its state: a job past its
 * deadline is claimed for its next attempt (run: true) or failed for good.
 */
export async function reconcile(admin: SupabaseClient, job: JobRow, now = Date.now()): Promise<Dispatch> {
  const decision = reconcileJob(job, now)
  if (decision.action === 'retry') {
    const claimed = await claimNextAttempt(admin, job, now)
    if (claimed) return { job: claimed, run: true }
    // Someone else claimed it; report what is there now.
    const { data } = await admin.from(TABLE).select('*').eq('id', job.id).maybeSingle()
    return { job: (data as JobRow | null) ?? job, run: false }
  }
  if (decision.action === 'fail') return { job: await markTimedOut(admin, job, now), run: false }
  return { job, run: false }
}

/**
 * The job for this piece of work: a fresh or in-flight one is reused, a stale
 * one is reconciled, and otherwise a new job is created with its first attempt
 * already claimed.
 */
export async function findOrCreateJob(
  admin: SupabaseClient,
  input: { userId: string; portfolioId: string; kind: JobKind; params: JobParams },
  now = Date.now(),
): Promise<Dispatch> {
  const key = jobKey(input.userId, input.kind, input.portfolioId, input.params)

  const { data: latest } = await admin
    .from(TABLE)
    .select('*')
    .eq('job_key', key)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest) {
    const existing = latest as JobRow
    if (isReusable(existing, now)) return { job: existing, run: false }
    const reconciled = await reconcile(admin, existing, now)
    if (reconciled.run || reconciled.job.status === 'processing' || reconciled.job.status === 'retrying') {
      return reconciled
    }
    // Completed but expired, or failed: the user is asking again, so start over.
  }

  const policy = JOB_POLICY[input.kind]
  const { data: created, error } = await admin
    .from(TABLE)
    .insert({
      user_id: input.userId,
      portfolio_id: input.portfolioId,
      kind: input.kind,
      params: input.params,
      job_key: key,
      status: 'processing' satisfies JobStatus,
      attempts: 1,
      max_attempts: policy.maxAttempts,
      deadline_at: attemptDeadline(input.kind, now),
      created_at: iso(now),
      updated_at: iso(now),
    })
    .select('*')
    .single()

  if (error || !created) throw new Error(`No se pudo crear el job: ${error?.message ?? 'sin respuesta'}`)
  return { job: created as JobRow, run: true }
}

/**
 * Run the attempt a job has claimed and record how it ended.
 *
 * One attempt per call. A failure with attempts left leaves the job `retrying`
 * with a short backoff, and the next status poll dispatches it — in a fresh
 * invocation with its own time budget, rather than stacking retries into the
 * one that just failed. Writes are conditional on the attempt number, so an
 * attempt that finishes after a newer one was claimed changes nothing.
 */
export async function executeJob(
  admin: SupabaseClient,
  userClient: SupabaseClient,
  job: JobRow,
  elapsedMs = 0,
): Promise<void> {
  const compute = COMPUTE[job.kind]

  // What is left of this invocation, not what the policy would like. The
  // request has already authenticated, checked the portfolio and written a job
  // row by the time after() runs, and a 50-second attempt on top of that
  // overshoots the platform's 60 — which kills the function mid-write, losing
  // a calculation that had finished.
  const budgetMs = attemptBudgetMs(job.kind, elapsedMs)
  if (budgetMs < JOB_MIN_ATTEMPT_MS) {
    await recordFailure(
      admin,
      job,
      'timeout',
      `No quedaba tiempo en esta invocacion para el cálculo (${Math.max(0, Math.round(budgetMs))} ms).`,
      Date.now(),
      { budgetMs, elapsedMs, started: false },
    )
    return
  }

  const outcome = await runAttempt(
    () => compute(userClient, job.portfolio_id, job.params ?? {}),
    budgetMs,
  )
  const now = Date.now()

  if (outcome.ok) {
    const { data: finished } = await admin
      .from(TABLE)
      .update({
        status: 'completed' satisfies JobStatus,
        result: outcome.result,
        error: null,
        error_kind: null,
        completed_at: iso(now),
        updated_at: iso(now),
      })
      .eq('id', job.id)
      .eq('attempts', job.attempts)
      .eq('status', 'processing')
      .select('id')
    if (finished && finished.length > 0 && successIsNews(job.created_at, now)) await announce(admin, job, true)
    return
  }

  await recordFailure(admin, job, outcome.errorKind, outcome.error, now, {
    budgetMs,
    elapsedMs,
    started: true,
  })
}

/**
 * Write a failed attempt down, and report a timeout as its own kind of event.
 *
 * A job that ran out of time is not the same as a job that threw: it usually
 * means the work no longer fits the invocation it was given, which is a
 * capacity problem rather than a bug in the calculation. It is worth being
 * able to count them separately, which is what the distinct message is for.
 */
async function recordFailure(
  admin: SupabaseClient,
  job: JobRow,
  errorKind: JobErrorKind,
  error: string,
  now: number,
  context: { budgetMs: number; elapsedMs: number; started: boolean },
): Promise<void> {
  const next = outcomeOfFailure(job, errorKind, error, now)
  const { data: recorded } = await admin
    .from(TABLE)
    .update({ ...next, updated_at: iso(now) })
    .eq('id', job.id)
    .eq('attempts', job.attempts)
    .eq('status', 'processing')
    .select('id')

  if (errorKind === 'timeout') {
    Sentry.captureMessage('Background job ran out of its invocation budget', {
      level: next.status === 'failed' ? 'error' : 'warning',
      extra: {
        kind: job.kind,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        policyTimeoutMs: JOB_POLICY[job.kind].timeoutMs,
        ...context,
      },
    })
  }

  // A failure with attempts left is not news yet; the retry may still succeed.
  if (next.status === 'failed' && recorded && recorded.length > 0) await announce(admin, job, false)
}

/**
 * The nightly sweep: fail unfinished jobs nobody has looked at for an hour past
 * their deadline, and delete finished jobs older than a week.
 *
 * Status polls reconcile stale jobs as they read them; this covers the ones no
 * one polls again — a closed tab — so nothing is left `processing` in the table
 * either.
 */
export async function sweepJobs(admin: SupabaseClient, now = Date.now()): Promise<{ failed: number; deleted: number }> {
  const { data: failed } = await admin
    .from(TABLE)
    .update({
      status: 'failed' satisfies JobStatus,
      error: 'El job quedo sin terminar y nadie volvio a consultarlo.',
      error_kind: 'timeout' satisfies JobErrorKind,
      updated_at: iso(now),
    })
    .in('status', ['processing', 'retrying'])
    .lt('deadline_at', iso(now - SWEEP_AFTER_MS))
    .select('id, kind, user_id, portfolio_id')

  // The tab that started these is gone, so the inbox is the only place left to
  // say they did not finish.
  for (const job of (failed ?? []) as JobRow[]) await announce(admin, job, false)

  const { data: deleted } = await admin
    .from(TABLE)
    .delete()
    .in('status', ['completed', 'failed'])
    .lt('updated_at', iso(now - RETENTION_MS))
    .select('id')

  return { failed: failed?.length ?? 0, deleted: deleted?.length ?? 0 }
}

/** What a client is allowed to see of a job. */
export function publicJob(job: JobRow, options: { reused?: boolean } = {}) {
  // A completed job handed back without running again is a stored result (P2-10).
  const result =
    job.status === 'completed'
      ? markServed(job.result, options.reused ? 'cache' : 'computed', JOB_POLICY[job.kind as JobKind].resultTtlSeconds)
      : null
  return {
    job_id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    error: job.status === 'failed' || job.status === 'retrying' ? job.error : null,
    error_kind: job.status === 'failed' || job.status === 'retrying' ? job.error_kind : null,
    result,
    created_at: job.created_at,
    updated_at: job.updated_at,
  }
}
