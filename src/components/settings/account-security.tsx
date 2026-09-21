'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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

/**
 * Settings → Cuenta y seguridad: what a person needs to do with the account
 * itself, as opposed to how the app looks.
 */
export function AccountSecurity() {
  const { t } = useTranslation()
  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t.account.security_title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <SignOutEverywhere />
      </CardContent>
    </Card>
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
