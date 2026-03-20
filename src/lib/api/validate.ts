import { type ZodSchema, ZodError } from 'zod'
import { error } from './response'

export async function validate<T>(schema: ZodSchema<T>, data: unknown): Promise<{ data: T } | { error: ReturnType<typeof error> }> {
  try {
    const parsed = schema.parse(data)
    return { data: parsed }
  } catch (e) {
    if (e instanceof ZodError) {
      const messages = e.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ')
      return { error: error(messages, 400) }
    }
    return { error: error('Invalid input', 400) }
  }
}
