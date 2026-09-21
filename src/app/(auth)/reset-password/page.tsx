'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslation } from '@/lib/i18n'
import { authProblem, MIN_PASSWORD_LENGTH, newPasswordProblem } from '@/lib/auth/password'

type Status = 'checking' | 'ready' | 'no-session'

/**
 * Reached from a recovery link, after /auth/callback has turned it into a
 * session. Without one — the link was opened in another browser, already used,
 * or expired — there is nothing to set a password on, and the page says how to
 * get a new link instead of showing a form that would fail.
 */
export default function ResetPasswordPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => setStatus(user ? 'ready' : 'no-session'))
      .catch(() => setStatus('no-session'))
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const problem = newPasswordProblem(password, confirmation)
    if (problem === 'too_short') {
      setError(t.account.password_too_short.replace('{min}', String(MIN_PASSWORD_LENGTH)))
      return
    }
    if (problem === 'mismatch') {
      setError(t.account.passwords_dont_match)
      return
    }

    setSaving(true)
    const { error } = await createClient().auth.updateUser({ password })
    setSaving(false)

    if (error) {
      const reason = authProblem(error)
      if (reason === 'session_missing') {
        setStatus('no-session')
        return
      }
      setError(
        reason === 'same_password'
          ? t.account.same_password
          : reason === 'weak_password'
            ? t.account.weak_password
            : t.account.unexpected_error,
      )
      return
    }

    toast.success(t.account.password_saved)
    router.push('/dashboard')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl"><h1>{t.account.reset_title}</h1></CardTitle>
          {status === 'ready' && <CardDescription>{t.account.reset_desc}</CardDescription>}
        </CardHeader>
        <CardContent>
          {status === 'checking' && <p className="text-sm text-center text-muted-foreground" aria-busy="true">…</p>}

          {status === 'no-session' && (
            <div className="space-y-4 text-center">
              <p role="alert" className="text-sm">{t.account.link_invalid}</p>
              <Link href="/forgot-password" className="text-sm text-primary underline underline-offset-4">
                {t.account.request_new_link}
              </Link>
            </div>
          )}

          {status === 'ready' && (
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">{t.account.new_password}</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">{t.account.confirm_password}</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                />
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? t.account.saving : t.account.save_password}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
