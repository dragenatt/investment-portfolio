import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET as getWatchlist, PATCH as patchWatchlist, DELETE as deleteWatchlist } from '@/app/api/watchlist/[id]/route'
import { POST as addWatchlistItem } from '@/app/api/watchlist/[id]/add/route'
import { DELETE as removeWatchlistItem } from '@/app/api/watchlist/[id]/[symbol]/route'

// Mock Supabase
const mockSupabaseClient = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(() => mockSupabaseClient),
}))

describe('Watchlist API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/watchlist/[id]', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
      })

      const response = await getWatchlist(
        new Request('http://localhost/api/watchlist/123'),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
      expect(data.data).toBeNull()
    })

    it('returns watchlist when found and user is authorized', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockWatchlistData = {
        id: 'watchlist-123',
        user_id: 'user-123',
        name: 'My Stocks',
        watchlist_items: [
          { symbol: 'AAPL', asset_type: 'stock' },
        ],
      }

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: mockWatchlistData,
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from.mockReturnValueOnce(mockQuery)

      const response = await getWatchlist(
        new Request('http://localhost/api/watchlist/watchlist-123'),
        { params: Promise.resolve({ id: 'watchlist-123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toEqual(mockWatchlistData)
      expect(data.error).toBeNull()
    })

    it('returns 404 when watchlist not found', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: null,
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from.mockReturnValueOnce(mockQuery)

      const response = await getWatchlist(
        new Request('http://localhost/api/watchlist/nonexistent'),
        { params: Promise.resolve({ id: 'nonexistent' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Watchlist not found')
    })

    it('returns 500 on database error', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: null,
          error: { message: 'Database connection failed' },
        }),
        select: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from.mockReturnValueOnce(mockQuery)

      const response = await getWatchlist(
        new Request('http://localhost/api/watchlist/123'),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Database connection failed')
    })
  })

  describe('PATCH /api/watchlist/[id]', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
      })

      const response = await patchWatchlist(
        new Request('http://localhost/api/watchlist/123', {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Updated' }),
        }),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('returns 403 when user does not own watchlist', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { user_id: 'different-user' },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from.mockReturnValueOnce(mockQuery)

      const response = await patchWatchlist(
        new Request('http://localhost/api/watchlist/123', {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Hacked' }),
        }),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Forbidden')
    })

    it('updates watchlist when authorized', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockVerifyQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { user_id: 'user-123' },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      const mockUpdateQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: {
            id: '123',
            user_id: 'user-123',
            name: 'Updated Name',
            watchlist_items: [],
          },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from
        .mockReturnValueOnce(mockVerifyQuery)
        .mockReturnValueOnce(mockUpdateQuery)

      const response = await patchWatchlist(
        new Request('http://localhost/api/watchlist/123', {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Updated Name' }),
        }),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.name).toBe('Updated Name')
    })
  })

  describe('DELETE /api/watchlist/[id]', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
      })

      const response = await deleteWatchlist(
        new Request('http://localhost/api/watchlist/123', { method: 'DELETE' }),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('returns 403 when user does not own watchlist', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { user_id: 'different-user' },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from.mockReturnValueOnce(mockQuery)

      const response = await deleteWatchlist(
        new Request('http://localhost/api/watchlist/123', { method: 'DELETE' }),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Forbidden')
    })

    it('deletes watchlist when authorized', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockVerifyQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { user_id: 'user-123' },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      const mockDeleteQuery = {
        eq: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from
        .mockReturnValueOnce(mockVerifyQuery)
        .mockReturnValueOnce(mockDeleteQuery)

      const response = await deleteWatchlist(
        new Request('http://localhost/api/watchlist/123', { method: 'DELETE' }),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toBeNull()
    })
  })

  describe('POST /api/watchlist/[id]/add', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
      })

      const response = await addWatchlistItem(
        new Request('http://localhost/api/watchlist/123/add', {
          method: 'POST',
          body: JSON.stringify({ symbol: 'AAPL', asset_type: 'stock' }),
        }),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('returns 403 when user does not own watchlist', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { user_id: 'different-user' },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from.mockReturnValueOnce(mockQuery)

      const response = await addWatchlistItem(
        new Request('http://localhost/api/watchlist/123/add', {
          method: 'POST',
          body: JSON.stringify({ symbol: 'AAPL', asset_type: 'stock' }),
        }),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Forbidden')
    })

    it('returns 400 on invalid symbol format', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { user_id: 'user-123' },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from.mockReturnValueOnce(mockQuery)

      const response = await addWatchlistItem(
        new Request('http://localhost/api/watchlist/123/add', {
          method: 'POST',
          body: JSON.stringify({ symbol: 'invalid symbol!@#', asset_type: 'stock' }),
        }),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('symbol')
    })

    it('adds item and returns 201 when authorized and valid', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockVerifyQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { user_id: 'user-123' },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      const mockInsertQuery = {
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { id: 'item-1', symbol: 'AAPL', asset_type: 'stock', watchlist_id: '123' },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from
        .mockReturnValueOnce(mockVerifyQuery)
        .mockReturnValueOnce(mockInsertQuery)

      const response = await addWatchlistItem(
        new Request('http://localhost/api/watchlist/123/add', {
          method: 'POST',
          body: JSON.stringify({ symbol: 'AAPL', asset_type: 'stock' }),
        }),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.data.symbol).toBe('AAPL')
    })

    it('rejects missing required fields', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { user_id: 'user-123' },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from.mockReturnValueOnce(mockQuery)

      const response = await addWatchlistItem(
        new Request('http://localhost/api/watchlist/123/add', {
          method: 'POST',
          body: JSON.stringify({ symbol: 'AAPL' }),
        }),
        { params: Promise.resolve({ id: '123' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('asset_type')
    })
  })

  describe('DELETE /api/watchlist/[id]/[symbol]', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
      })

      const response = await removeWatchlistItem(
        new Request('http://localhost/api/watchlist/123/AAPL', { method: 'DELETE' }),
        { params: Promise.resolve({ id: '123', symbol: 'AAPL' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('returns 403 when user does not own watchlist', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { user_id: 'different-user' },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from.mockReturnValueOnce(mockQuery)

      const response = await removeWatchlistItem(
        new Request('http://localhost/api/watchlist/123/AAPL', { method: 'DELETE' }),
        { params: Promise.resolve({ id: '123', symbol: 'AAPL' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Forbidden')
    })

    it('removes item when authorized', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'user-123' } },
      })

      const mockVerifyQuery = {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { user_id: 'user-123' },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      }

      const mockDeleteQuery = {
        eq: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      }

      mockSupabaseClient.from
        .mockReturnValueOnce(mockVerifyQuery)
        .mockReturnValueOnce(mockDeleteQuery)

      const response = await removeWatchlistItem(
        new Request('http://localhost/api/watchlist/123/AAPL', { method: 'DELETE' }),
        { params: Promise.resolve({ id: '123', symbol: 'AAPL' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toBeNull()
    })
  })
})
