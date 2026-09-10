import { z } from 'zod'

/**
 * A goal's editable shape.
 *
 * The bounds mirror the CHECK constraints in migration 014 rather than being
 * looser: a value the database will reject should be rejected here, where the
 * user can still see which field caused it.
 */
export const CreateGoalSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  portfolio_id: z.string().uuid().optional().nullable(),

  target_amount: z.number().positive().finite(),
  currency: z.enum(['MXN', 'USD', 'EUR']).default('MXN'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  starting_capital: z.number().min(0).finite().default(0),
  monthly_contribution: z.number().min(0).finite().default(0),

  risk_profile: z.enum(['Conservador', 'Moderado', 'Agresivo']).optional(),
  expected_annual_return: z.number().min(-1).max(1).optional(),
  expected_annual_volatility: z.number().min(0).max(3).optional(),
})

export const UpdateGoalSchema = CreateGoalSchema.partial().extend({
  status: z.enum(['active', 'reached', 'paused', 'cancelled']).optional(),
})

export type CreateGoalInput = z.infer<typeof CreateGoalSchema>
export type UpdateGoalInput = z.infer<typeof UpdateGoalSchema>
