import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetcher } from '@/lib/api/fetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  }
}

describe('apiFetcher', () => {
  it('returns data on success', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { id: 1, name: 'Test' } }))

    const result = await apiFetcher('/api/test')
    expect(result).toEqual({ id: 1, name: 'Test' })
  })

  it('throws on error response', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Something went wrong', data: null }, 400))

    await expect(apiFetcher('/api/test')).rejects.toThrow('Something went wrong')
  })

  it('handles network failures', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(apiFetcher('/api/test')).rejects.toThrow('Failed to fetch')
  })

  it('throws on non-JSON responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'text/html' }),
    })

    await expect(apiFetcher('/api/test')).rejects.toThrow('Error del servidor (500)')
  })

  it('throws on HTTP error even with no error field', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: null }, 500))

    await expect(apiFetcher('/api/test')).rejects.toThrow('Error del servidor (500)')
  })

  it('returns null data without throwing when API returns null', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: null, error: null }))

    const result = await apiFetcher('/api/test')
    expect(result).toBeNull()
  })

  it('passes the URL and options to fetch', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [], error: null }))

    await apiFetcher('https://example.com/api/items')
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/api/items', {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    })
  })

  it('throws auth error on redirected response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      redirected: true,
      headers: new Headers({ 'content-type': 'text/html' }),
    })

    await expect(apiFetcher('/api/test')).rejects.toThrow('Sesión expirada')
  })

  it('throws Unauthorized on 401 non-JSON response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      redirected: false,
      headers: new Headers({ 'content-type': 'text/html' }),
    })

    await expect(apiFetcher('/api/test')).rejects.toThrow('Unauthorized')
  })
})
