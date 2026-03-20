import { z } from 'zod'

export const CreateAlertSchema = z.object({
  symbol: z.string().max(20).regex(/^[A-Z0-9.:-]+$/),
  condition: z.enum(['above', 'below', 'pct_change_daily']),
  target_value: z.number(),
})

export const UpdateAlertSchema = z.object({
  condition: z.enum(['above', 'below', 'pct_change_daily']).optional(),
  target_value: z.number().optional(),
  is_active: z.boolean().optional(),
})
