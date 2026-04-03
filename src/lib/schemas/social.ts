import { z } from 'zod'

export const UpdateVisibilitySchema = z.object({
  visibility: z.enum(['public', 'private', 'shared']),
  show_amounts: z.boolean().optional(),
  show_positions: z.boolean().optional(),
  show_transactions: z.boolean().optional(),
  show_allocation: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
})

export const UpdateSocialProfileSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  bio: z.string().max(300).optional(),
  location: z.string().max(100).optional(),
  website: z.string().url().optional().or(z.literal('')),
})

export const SharePortfolioSchema = z.object({
  shared_with_user_id: z.string().uuid().optional(),
  shared_via: z.enum(['link', 'user', 'email']),
  permission: z.enum(['view', 'compare']),
  expires_at: z.string().datetime().optional(),
})

export const SaveComparisonSchema = z.object({
  name: z.string().min(1).max(100),
  portfolio_ids: z.array(z.string().uuid()).min(2).max(5),
  period: z.enum(['1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'ALL']),
  metrics: z.array(z.string()),
})
