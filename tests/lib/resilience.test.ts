import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withRetry, CircuitBreaker } from '@/lib/services/resilience'

describe('withRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success')
    const result = await withRetry(fn)
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on failure and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValueOnce('success')
    
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 })
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent failure'))
    
    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 })
    ).rejects.toThrow('persistent failure')
    
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('calls onRetry callback', async () => {
    const onRetry = vi.fn()
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockResolvedValueOnce('success')
    
    await withRetry(fn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, onRetry })
    
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error))
  })

  it('retries with increasing delays (exponential backoff)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    const timestamps: number[] = []

    // Track timing of each call
    fn.mockImplementation(() => {
      timestamps.push(Date.now())
      return Promise.reject(new Error('fail'))
    })

    const start = Date.now()
    try {
      await withRetry(fn, { maxRetries: 2, baseDelayMs: 50, maxDelayMs: 500 })
    } catch {
      // Expected to fail
    }

    // Should have 3 total calls (initial + 2 retries)
    expect(fn).toHaveBeenCalledTimes(3)

    // Total elapsed time should be at least baseDelayMs*1 + baseDelayMs*2 = 150ms
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(50)
  })

  it('respects maxDelayMs cap', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'))

    const start = Date.now()
    try {
      await withRetry(fn, { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 50 })
    } catch {
      // Expected to fail
    }

    // With maxDelayMs=50, total delay should be capped
    const elapsed = Date.now() - start
    // At most 2 retries * 50ms + overhead < 300ms
    expect(elapsed).toBeLessThan(500)
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts in closed state', () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 3,
      resetTimeoutMs: 5000,
      successThreshold: 2,
    })
    
    expect(breaker.getState()).toBe('closed')
  })

  it('opens after reaching failure threshold', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 2,
      resetTimeoutMs: 5000,
      successThreshold: 2,
    })
    
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    
    // First failure
    await expect(breaker.execute(fn)).rejects.toThrow()
    expect(breaker.getState()).toBe('closed')
    
    // Second failure triggers open
    await expect(breaker.execute(fn)).rejects.toThrow()
    expect(breaker.getState()).toBe('open')
  })

  it('rejects calls when open', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 1,
      resetTimeoutMs: 5000,
      successThreshold: 1,
    })
    
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    
    // Trigger open state
    await expect(breaker.execute(fn)).rejects.toThrow('fail')
    expect(breaker.getState()).toBe('open')
    
    // Now should reject immediately with circuit breaker error
    const fn2 = vi.fn().mockResolvedValue('success')
    await expect(breaker.execute(fn2)).rejects.toThrow('Circuit breaker [test] is OPEN')
    
    // Original function should not have been called again
    expect(fn2).not.toHaveBeenCalled()
  })

  it('transitions to half-open after reset timeout', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 1,
      resetTimeoutMs: 5000,
      successThreshold: 1,
    })
    
    const fn = vi.fn().mockRejectedValue(new Error('fail'))
    
    // Trigger open state
    await expect(breaker.execute(fn)).rejects.toThrow()
    expect(breaker.getState()).toBe('open')
    
    // Advance time past reset timeout
    vi.advanceTimersByTime(5001)
    
    // Next execute attempt should transition to half-open, execute, and close (threshold=1)
    const fn2 = vi.fn().mockResolvedValue('success')
    const result = await breaker.execute(fn2)
    expect(result).toBe('success')
    // With successThreshold=1, one success closes it immediately
    expect(breaker.getState()).toBe('closed')
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  it('closes after success threshold in half-open', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      successThreshold: 2,
    })
    
    // Trigger open state
    const failFn = vi.fn().mockRejectedValue(new Error('fail'))
    await expect(breaker.execute(failFn)).rejects.toThrow()
    expect(breaker.getState()).toBe('open')
    
    // Advance past reset timeout to half-open
    vi.advanceTimersByTime(1001)
    
    // First success in half-open
    const successFn = vi.fn().mockResolvedValue('success')
    await breaker.execute(successFn)
    expect(breaker.getState()).toBe('half-open')
    
    // Second success in half-open reaches threshold
    await breaker.execute(successFn)
    expect(breaker.getState()).toBe('closed')
    expect(successFn).toHaveBeenCalledTimes(2)
  })

  it('reopens on failure in half-open state', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      successThreshold: 2,
    })
    
    // Trigger open state
    const failFn = vi.fn().mockRejectedValue(new Error('fail'))
    await expect(breaker.execute(failFn)).rejects.toThrow()
    
    // Advance past reset timeout to half-open
    vi.advanceTimersByTime(1001)
    
    // Fail in half-open should reopen
    await expect(breaker.execute(failFn)).rejects.toThrow()
    expect(breaker.getState()).toBe('open')
  })

  it('reset() restores to closed state', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 1,
      resetTimeoutMs: 5000,
      successThreshold: 1,
    })
    
    // Trigger open state
    const failFn = vi.fn().mockRejectedValue(new Error('fail'))
    await expect(breaker.execute(failFn)).rejects.toThrow()
    expect(breaker.getState()).toBe('open')
    
    // Reset
    breaker.reset()
    expect(breaker.getState()).toBe('closed')
    
    // Should accept calls again
    const successFn = vi.fn().mockResolvedValue('success')
    const result = await breaker.execute(successFn)
    expect(result).toBe('success')
  })

  it('resets failure count on success when closed', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 3,
      resetTimeoutMs: 5000,
      successThreshold: 1,
    })
    
    const failFn = vi.fn().mockRejectedValue(new Error('fail'))
    const successFn = vi.fn().mockResolvedValue('success')
    
    // Two failures
    await expect(breaker.execute(failFn)).rejects.toThrow()
    await expect(breaker.execute(failFn)).rejects.toThrow()
    expect(breaker.getState()).toBe('closed') // Not yet at threshold
    
    // Success should reset counter
    await breaker.execute(successFn)
    expect(breaker.getState()).toBe('closed')
    
    // Now need 3 more failures to open again
    await expect(breaker.execute(failFn)).rejects.toThrow()
    await expect(breaker.execute(failFn)).rejects.toThrow()
    expect(breaker.getState()).toBe('closed')
    
    await expect(breaker.execute(failFn)).rejects.toThrow()
    expect(breaker.getState()).toBe('open')
  })
})
