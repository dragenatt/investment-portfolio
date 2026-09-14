import { timingSafeEqual } from 'node:crypto'

// Authorisation for the cron routes (C6).
//
// Every cron route used to check `if (cronSecret && header !== ...)`, which
// fails OPEN: with CRON_SECRET unset — a preview environment, a renamed
// variable, a fresh project — anyone could trigger nightly snapshots for every
// user, run a backfill, or read cron status, all with the service role.
// Production has the secret set (verified: 401 without it), so this was latent.
//
// Now a missing secret denies everything, and the comparison runs in constant
// time so the secret cannot be recovered one byte at a time from response
// timing. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.

export function isAuthorizedCronRequest(authorization: string | null, secret: string | undefined): boolean {
  // Only emptiness is refused: the deployed secret's length is not visible from
  // here, and a length rule could silently stop the production crons.
  if (!secret) return false
  if (!authorization) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(authorization)
  if (received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}

export function cronRequestAuthorized(req: Request): boolean {
  return isAuthorizedCronRequest(req.headers.get('authorization'), process.env.CRON_SECRET)
}
