import { z } from 'zod'

export const CreateWatchlistSchema = z.object({
  name: z.string().min(1).max(100),
})

export const AddWatchlistItemSchema = z.object({
  symbol: z.string().max(20).regex(/^[A-Z0-9.:-]+$/),
  asset_type: z.enum(['stock', 'etf', 'crypto', 'bond', 'forex', 'commodity']),
})
