'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { clearOfflineUserData } from '@/lib/pwa/offline-data'
import { useTranslation } from '@/lib/i18n'
import { authProblem, MIN_PASSWORD_LENGTH, newPasswordProblem } from '@/lib/auth/password'

/**
 * Settings → Cuenta y seguridad: what a person needs to do with the account
 * itself, as opposed to how the app looks. None of it existed: the password
 * could not be changed, the email was a disabled field, and an account could
 * not be closed.
 *
 * `email` is the account's current address, or null while it loads.
 */
export function AccountSecurity({ email }: { email: string | null }) {
  const { t } = useTranslation()
  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t.account.security_title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <ChangePassword email={email} />
        <ChangeEmail email={email} />
        <SignOutEverywhere />
        <DeleteAccount />
      </CardContent>
    </Card>
  )
}

/**
 * Supabase's updateUser changes the password of whoever holds the session,
 * without asking for the current one. The form asks, and checks it by signing
 * in with it first: someone at an unlocked, signed-in browser should not be
 * able to lock the owner out in one step from here.
 */
function ChangePassword({ email }: { email: string | null }) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const problem = newPasswordProblem(next, confirmation)
    if (problem === 'too_short') {
      setError(t.account.password_too_short.replace('{min}', String(MIN_PASSWORD_LENGTH)))
      return
    }
    if (problem === 'mismatch') {
      setError(t.account.passwords_dont_match)
      return
    }
    if (!email) {
      setError(t.account.unexpected_error)
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { error: checkError } = await supabase.auth.signInWithPassword({ email, password: current })
    if (checkError) {
      setSaving(false)
      setError(authProblem(checkError) === 'rate_limited' ? t.account.rate_limited : t.account.wrong_current_password)
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: next })
    setSaving(false)
    if (updateError) {
      const reason = authProblem(updateError)
      setError(
        reason === 'same_password'
          ? t.account.same_password
          : reason === 'weak_password'
            ? t.account.weak_password
            : t.account.unexpected_error,
      )
      return
    }

    setCurrent('')
    setNext('')
    setConfirmation('')
    toast.success(t.account.password_changed)
  }

  return (
    <section className="space-y-3">
      <h2 className="font-medium">{t.account.change_password}</h2>
      <form onSubmit={submit} className="space-y-3">
        {/* Tells a password manager which account the new password belongs to. */}
        <input type="email" autoComplete="username" value={email ?? ''} readOnly hidden />
        <div className="space-y-2">
          <Label htmlFor="account-current-password">{t.account.current_password}</Label>
          <Input
            id="account-current-password"
            type="password"
            autoComplete="current-password"
            className="rounded-xl"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-new-password">{t.account.new_password}</Label>
          <Input
            id="account-new-password"
            type="password"
            autoComplete="new-password"
            className="rounded-xl"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="account-confirm-password">{t.account.confirm_password}</Label>
          <Input
            id="account-confirm-password"
            type="password"
            autoComplete="new-password"
            className="rounded-xl"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="rounded-xl" disabled={saving}>
          {saving ? t.account.saving : t.account.change_password}
        </Button>
      </form>
    </section>
  )
}

/**
 * Supabase sends a confirmation link to the new address — and, with secure
 * email change on, to the current one too — and the address changes only when
 * it is confirmed. The link returns through /auth/callback to Settings.
 */
function ChangeEmail({ email }: { email: string | null }) {
  const { t } = useTranslation()
  const [next, setNext] = useState('')
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const address = next.trim()
    if (email && address.toLowerCase() === email.toLowerCase()) {
      setError(t.account.same_email)
      return
    }

    setSending(true)
    const { error: updateError } = await createClient().auth.updateUser(
      { email: address },
      { emailRedirectTo: `${window.location.origin}/auth/callback?next=/settings` },
    )
    setSending(false)
    if (updateError) {
      const reason = authProblem(updateError)
      setError(
        reason === 'email_exists'
          ? t.account.email_exists
          : reason === 'rate_limited'
            ? t.account.rate_limited
            : t.account.unexpected_error,
      )
      return
    }
    setSentTo(address)
    setNext('')
  }

  return (
    <section className="space-y-3">
      <h2 className="font-medium">{t.account.change_email}</h2>
      {email && <p className="text-sm text-muted-foreground">{t.account.change_email_desc.replace('{email}', email)}</p>}
      {sentTo ? (
        <p role="status" className="text-sm">{t.account.email_change_sent.replace('{email}', sentTo)}</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="account-new-email">{t.account.new_email}</Label>
            <Input
              id="account-new-email"
              type="email"
              autoComplete="email"
              className="rounded-xl"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" variant="outline" className="rounded-xl" disabled={sending}>
            {sending ? t.account.sending : t.account.send_confirmation}
          </Button>
        </form>
      )}
    </section>
  )
}

/**
 * Revokes every session the account has. The menu's sign-out button used to do
 * this without saying so — Supabase's default scope is global — so signing out
 * of a phone also signed out the laptop. That button now signs out one device,
 * and this is where ending all of them is asked for by name.
 */
function SignOutEverywhere() {
  const { t } = useTranslation()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function signOutEverywhere() {
    setBusy(true)
    const { error } = await createClient().auth.signOut({ scope: 'global' })
    if (error) {
      setBusy(false)
      toast.error(t.account.sign_out_failed)
      return
    }
    // The pages and responses this device saved belong to the account too.
    await clearOfflineUserData()
    router.push('/login')
    router.refresh()
  }

  return (
    <section className="space-y-2">
      <h2 className="font-medium">{t.account.sign_out_everywhere}</h2>
      <p className="text-sm text-muted-foreground">{t.account.sign_out_everywhere_desc}</p>
      <Button variant="outline" className="rounded-xl" onClick={() => setOpen(true)}>
        {t.account.sign_out_everywhere}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.account.sign_out_everywhere}</DialogTitle>
            <DialogDescription>{t.account.sign_out_everywhere_confirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t.common.cancel}
            </Button>
            <Button onClick={signOutEverywhere} disabled={busy}>
              {busy ? t.account.signing_out : t.account.sign_out_everywhere}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/**
 * Closes the account for good (DELETE /api/user/account). Asks for the
 * password, which the server checks again, and for a typed word, so it cannot
 * happen by a slip of the mouse.
 */
function DeleteAccount() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const word = t.account.delete_account_word
  const ready = password.length > 0 && typed.trim().toUpperCase() === word

  function changeOpen(next: boolean) {
    setOpen(next)
    if (!next) {
      setPassword('')
      setTyped('')
      setError('')
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/user/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        await clearOfflineUserData()
        toast.success(t.account.account_deleted)
        // A full load, not router.push: the SWR cache and every other copy of
        // the deleted account's data held in memory must go with it.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign('/')
        return
      }
      setError(res.status === 403 ? t.account.wrong_current_password : t.account.delete_unavailable)
    } catch {
      setError(t.account.delete_unavailable)
    }
    setBusy(false)
  }

  return (
    <section className="space-y-2">
      <h2 className="font-medium text-destructive">{t.account.delete_account}</h2>
      <p className="text-sm text-muted-foreground">{t.account.delete_account_desc}</p>
      <Button variant="destructive" className="rounded-xl" onClick={() => changeOpen(true)}>
        {t.account.delete_account}
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.account.delete_account}</DialogTitle>
            <DialogDescription>
              {t.account.delete_account_desc} {t.account.delete_account_confirm.replace('{word}', word)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="delete-account-password">{t.account.current_password}</Label>
              <Input
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delete-account-word">{t.account.delete_account_word_label.replace('{word}', word)}</Label>
              <Input id="delete-account-word" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => changeOpen(false)} disabled={busy}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={remove} disabled={!ready || busy}>
              {busy ? t.account.deleting : t.account.delete_account_submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
