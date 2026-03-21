import { z } from 'zod'

export const RenameWatchlistSchema = z.object({
  name: z.string().min(1).max(50).transform(s => s.trim()),
})
