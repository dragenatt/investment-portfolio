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

/**
 * One answer the model gave about a goal, as the advisor records it.
 *
 * Bounds mirror migration 014: probability between 0 and 100, a positive
 * target, non-negative money. Every numeric output may be null — a run that
 * could not estimate something says so rather than writing a zero.
 */
const money = z.number().finite()
export const CreateProjectionSchema = z.object({
  model_version: z.string().min(1).max(40),
  seed: z.number().int().nullable(),
  simulations: z.number().int().positive().nullable(),
  target_amount: z.number().positive().finite(),
  starting_capital: z.number().min(0).finite(),
  monthly_contribution: z.number().min(0).finite(),
  horizon_months: z.number().int().positive(),
  expected_annual_return: z.number().min(-1).max(1).nullable(),
  expected_annual_volatility: z.number().min(0).max(3).nullable(),
  probability_pct: z.number().min(0).max(100).nullable(),
  deterministic_final: money.nullable(),
  p10_final: money.nullable(),
  p50_final: money.nullable(),
  p90_final: money.nullable(),
  required_contribution: money.min(0).nullable(),
})

export type CreateProjectionInput = z.infer<typeof CreateProjectionSchema>

/** A goal with its first projection, which is how the advisor saves one. */
export const CreateGoalWithProjectionSchema = CreateGoalSchema.extend({
  projection: CreateProjectionSchema.optional(),
})
