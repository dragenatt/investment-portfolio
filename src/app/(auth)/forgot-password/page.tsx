'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslation } from '@/lib/i18n'
import { authProblem } from '@/lib/auth/password'

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function requestLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    // The link comes back through /auth/callback, which exchanges its code for
    // a session and continues to the page that sets the password. The code's
    // verifier is a cookie set by this call, so the link only works in this
    // browser — the confirmation below says so.
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
    setLoading(false)

    // The same confirmation whether or not an account uses this address:
    // anything else would let anyone test which emails are registered. Only a
    // refusal to send at all is reported.
    if (error && authProblem(error) === 'rate_limited') {
      setError(t.account.rate_limited)
      return
    }
    setSent(true)
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl"><h1>{t.account.forgot_title}</h1></CardTitle>
          <CardDescription>{t.account.forgot_desc}</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p role="status" className="text-sm text-center">{t.account.forgot_sent}</p>
          ) : (
            <form onSubmit={requestLink} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t.auth.email}</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t.account.sending : t.account.forgot_submit}
              </Button>
            </form>
          )}
          <p className="text-sm text-muted-foreground text-center mt-4">
            <Link href="/login" className="text-primary underline underline-offset-4">{t.account.back_to_login}</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
