// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The SDK was imported at the top of api/handler.ts, api/response.ts and
// instrumentation.ts — so every cold start of every function loaded 1.65 MB of
// JavaScript before serving anything, including the deploys with no DSN, where
// it reports nothing at all.

const calls = vi.hoisted(() => ({ exceptions: [] as unknown[], messages: [] as string[], imports: 0 }))

vi.mock('@sentry/nextjs', () => {
  calls.imports++
  return {
    captureException: (err: unknown) => calls.exceptions.push(err),
    captureMessage: (message: string) => calls.messages.push(message),
  }
})

const { reportException, reportMessage, reportingEnabled } = await import('@/lib/observability/sentry')

const DSN = process.env.SENTRY_DSN

beforeEach(() => {
  calls.exceptions.length = 0
  calls.messages.length = 0
  calls.imports = 0
  delete process.env.SENTRY_DSN
})

afterEach(() => {
  if (DSN) process.env.SENTRY_DSN = DSN
  else delete process.env.SENTRY_DSN
  vi.restoreAllMocks()
})

describe('with no DSN configured', () => {
  it('reports nothing and loads nothing', async () => {
    expect(reportingEnabled()).toBe(false)

    await reportException(new Error('boom'))
    await reportMessage('something')

    expect(calls.exceptions).toEqual([])
    expect(calls.messages).toEqual([])
    // The point of the exercise: the SDK was never asked for.
    expect(calls.imports).toBe(0)
  })
})

describe('with a DSN configured', () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1'
  })

  it('passes the exception and its context to the SDK', async () => {
    const err = new Error('boom')

    await reportException(err, { tags: { area: 'api' } })

    expect(reportingEnabled()).toBe(true)
    expect(calls.exceptions).toEqual([err])
  })

  it('passes a message through too', async () => {
    await reportMessage('CSP violation', { level: 'warning' })

    expect(calls.messages).toEqual(['CSP violation'])
  })
})

describe('when reporting itself fails', () => {
  it('does not turn a failure to report into a failure', async () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1'
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.doMock('@sentry/nextjs', () => {
      throw new Error('the SDK could not be loaded')
    })
    vi.resetModules()
    const fresh = await import('@/lib/observability/sentry')

    await expect(fresh.reportException(new Error('boom'))).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalled()
  })
})
