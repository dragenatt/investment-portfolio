import { z } from 'zod'

export const CreateTransactionSchema = z.object({
  portfolio_id: z.string().uuid(),
  symbol: z.string().max(20).regex(/^[A-Z0-9.\-:=^]+$/),
  asset_type: z.enum(['stock', 'etf', 'crypto', 'bond', 'forex', 'commodity', 'index']),
  type: z.enum(['buy', 'sell', 'dividend', 'split']),
  quantity: z.number().positive().max(999_999_999),
  price: z.number().positive().max(999_999_999),
  fees: z.number().min(0).default(0),
  currency: z.enum(['MXN', 'USD', 'EUR']),
  executed_at: z.string().datetime(),
  notes: z.string().max(500).optional(),
})

export const UpdateTransactionSchema = z.object({
  type: z.enum(['buy', 'sell', 'dividend', 'split']).optional(),
  quantity: z.number().positive().max(999_999_999).optional(),
  price: z.number().positive().max(999_999_999).optional(),
  fees: z.number().min(0).optional(),
  currency: z.enum(['MXN', 'USD', 'EUR']).optional(),
  executed_at: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
})
