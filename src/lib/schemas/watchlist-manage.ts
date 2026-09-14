import { z } from 'zod'

export const RenameWatchlistSchema = z.object({
  // Same limit as CreateWatchlistSchema, so a list can always be renamed to its own name.
  name: z.string().trim().min(1).max(100),
})
