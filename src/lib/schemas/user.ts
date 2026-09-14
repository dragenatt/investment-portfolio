import { z } from 'zod'

/** http(s) only: a `javascript:` URL is a valid URL and would run when clicked. */
const httpUrl = z
  .string()
  .trim()
  .max(200)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Debe empezar con http:// o https://')

export const UpdateProfileSchema = z.object({
  display_name: z.string().trim().min(1).max(100).optional(),
  avatar_url: httpUrl.optional(),
  // The profile settings page sends these four, and the schema used to strip
  // them: the page said "Perfil actualizado" and nothing was saved (C6).
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,30}$/, 'Usuario: 3 a 30 letras, números o guion bajo')
    .optional(),
  bio: z.string().trim().max(300).optional(),
  location: z.string().trim().max(50).optional(),
  // An empty field clears the website.
  website: z.union([z.literal('').transform(() => null), httpUrl]).optional(),
})

export const UpdatePreferencesSchema = z.object({
  base_currency: z.enum(['MXN', 'USD', 'EUR']).optional(),
  // Ajustes offers Sistema too; saving with it selected used to answer 400.
  theme: z.enum(['light', 'dark', 'system']).optional(),
})
