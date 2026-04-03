/**
 * Production-grade resilience utilities for external API calls.
 * Includes retry with exponential backoff and circuit breaker pattern.
 */

// Retry with exponential backoff
interface RetryOptions {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  onRetry?: (attempt: number, error: Error) => void
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 5000 }
): Promise<T> {
  let lastError: Error
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < options.maxRetries) {
        const delay = Math.min(
          options.baseDelayMs * Math.pow(2, attempt) + Math.random() * 200,
          options.maxDelayMs
        )
        options.onRetry?.(attempt + 1, lastError)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError!
}

// Circuit Breaker
type CircuitState = 'closed' | 'open' | 'half-open'

interface CircuitBreakerOptions {
  failureThreshold: number     // failures before opening
  resetTimeoutMs: number       // time before trying half-open
  successThreshold: number     // successes in half-open to close
  name: string                 // for logging
}

export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failures = 0
  private successes = 0
  private lastFailureTime = 0
  private readonly options: CircuitBreakerOptions

  constructor(options: CircuitBreakerOptions) {
    this.options = options
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs) {
        this.state = 'half-open'
        this.successes = 0
      } else {
        throw new Error(`Circuit breaker [${this.options.name}] is OPEN`)
      }
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess() {
    this.failures = 0
    if (this.state === 'half-open') {
      this.successes++
      if (this.successes >= this.options.successThreshold) {
        this.state = 'closed'
        console.log(`Circuit breaker [${this.options.name}] CLOSED`)
      }
    }
  }

  private onFailure() {
    this.failures++
    this.lastFailureTime = Date.now()
    if (this.failures >= this.options.failureThreshold) {
      this.state = 'open'
      console.warn(`Circuit breaker [${this.options.name}] OPENED after ${this.failures} failures`)
    }
  }

  getState(): CircuitState { return this.state }
  reset() { this.state = 'closed'; this.failures = 0; this.successes = 0 }
}
