import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'
import type { JobKind, JobStatus } from '@/lib/services/jobs'

// Client side of background jobs (C1): start the job, poll its status until it
// finishes, hand back its result in the same { data, isLoading, error } shape
// the synchronous hooks returned, so the components using them do not change.

type PublicJob<T> = {
  job_id: string
  kind: JobKind
  status: JobStatus
  attempts: number
  max_attempts: number
  error: string | null
  error_kind: 'timeout' | 'exception' | null
  result: T | null
}

/** How often an unfinished job is polled. */
const POLL_MS = 1500

async function startJob<T>([, kind, pid, paramsJson]: readonly [string, JobKind, string, string]): Promise<PublicJob<T>> {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ kind, portfolio_id: pid, params: JSON.parse(paramsJson) }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json || json.error) {
    const message = json?.error ?? `Error del servidor (${res.status})`
    throw Object.assign(new Error(message), { status: res.status })
  }
  return json.data as PublicJob<T>
}

export function useJob<T>(
  kind: JobKind,
  pid: string | null,
  params: Record<string, number> = {},
  options: {
    /** Re-run the job this often, in ms, like the synchronous hook's refreshInterval. */
    refreshInterval?: number
    /**
     * The synchronous endpoint for the same calculation. Used only when jobs are
     * unavailable in this environment (503), so the page still works.
     */
    fallbackUrl?: string
  } = {},
) {
  const paramsJson = JSON.stringify(params, Object.keys(params).sort())

  const start = useSWR<PublicJob<T>>(pid ? (['job', kind, pid, paramsJson] as const) : null, startJob, {
    revalidateOnFocus: false,
    refreshInterval: options.refreshInterval,
    // A failed start is retried by SWR's own error retry; a 4xx is not worth it.
    shouldRetryOnError: (err: { status?: number }) => !err?.status || err.status >= 500,
  })

  const jobsUnavailable = (start.error as { status?: number } | undefined)?.status === 503
  const startedJob = start.data
  const needsPolling = Boolean(startedJob && (startedJob.status === 'processing' || startedJob.status === 'retrying'))

  const poll = useSWR<PublicJob<T>>(
    needsPolling ? `/api/jobs/${startedJob!.job_id}/status` : null,
    apiFetcher,
    {
      refreshInterval: (latest) =>
        !latest || latest.status === 'processing' || latest.status === 'retrying' ? POLL_MS : 0,
      revalidateOnFocus: false,
      dedupingInterval: 0,
      // SWR pauses polling in a hidden tab by default. A job is short and the
      // polling stops at a terminal state, so it keeps going: switching tabs
      // while a Monte Carlo runs should find the result ready on return, not
      // start waiting then.
      refreshWhenHidden: true,
    },
  )

  const fallback = useSWR<T>(jobsUnavailable && options.fallbackUrl ? options.fallbackUrl : null, apiFetcher, {
    refreshInterval: options.refreshInterval,
  })

  if (jobsUnavailable && options.fallbackUrl) {
    return { data: fallback.data, isLoading: fallback.isLoading, error: fallback.error, status: undefined }
  }

  // The poll result is newer than the start result once it exists — unless the
  // start was re-run (refreshInterval) and produced a different job.
  const job = poll.data && startedJob && poll.data.job_id === startedJob.job_id ? poll.data : startedJob
  const failed = job?.status === 'failed'

  return {
    data: job?.status === 'completed' ? (job.result ?? undefined) : undefined,
    isLoading: !failed && !start.error && job?.status !== 'completed',
    error: start.error ?? poll.error ?? (failed ? new Error(job?.error ?? 'El calculo fallo.') : undefined),
    status: job?.status,
  }
}
