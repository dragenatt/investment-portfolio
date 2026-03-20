import { z } from 'zod'

export const UpdateProfileSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().optional(),
})

export const UpdatePreferencesSchema = z.object({
  base_currency: z.enum(['MXN', 'USD', 'EUR']).optional(),
  theme: z.enum(['light', 'dark']).optional(),
})
