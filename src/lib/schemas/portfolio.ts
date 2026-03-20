import { z } from 'zod'

export const CreatePortfolioSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  base_currency: z.enum(['MXN', 'USD', 'EUR']).default('MXN'),
})

export const UpdatePortfolioSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
})
