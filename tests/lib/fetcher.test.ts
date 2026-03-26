import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetcher } from '@/lib/api/fetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

describe('apiFetcher', () => {
  it('returns data on success', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ data: { id: 1, name: 'Test' } }),
    })

    const result = await apiFetcher('/api/test')
    expect(result).toEqual({ id: 1, name: 'Test' })
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ error: 'Something went wrong' }),
    })

    await expect(apiFetcher('/api/test')).rejects.toThrow('Something went wrong')
  })

  it('handles network failures', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(apiFetcher('/api/test')).rejects.toThrow('Failed to fetch')
  })

  it('returns undefined when data field is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true }),
    })

    const result = await apiFetcher('/api/test')
    expect(result).toBeUndefined()
  })

  it('passes the URL to fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ data: null }),
    })

    await apiFetcher('https://example.com/api/items')
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/api/items')
  })
})
