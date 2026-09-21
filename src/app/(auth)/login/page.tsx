'use client'

import { createClient } from '@/lib/supabase/client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { useTranslation } from '@/lib/i18n'
import { safeNextPath } from '@/lib/utils/safe-redirect'
import { clearOfflineUserData } from '@/lib/pwa/offline-data'

export default function LoginPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Whatever this device saved for offline use belonged to whoever signed in
    // last, who may not have signed out.
    await clearOfflineUserData()

    // Back to the page that sent them here, if it is a safe same-origin path.
    // Read from the location at submit time rather than useSearchParams, which
    // would need a Suspense boundary around the whole form to prerender.
    router.push(safeNextPath(new URLSearchParams(window.location.search).get('next')))
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/* The page's heading, not a styled div: this is the only heading on
              the page, and a screen reader had nothing to announce it by.
              Tailwind's preflight leaves an h1 at the size of its parent, so
              it looks exactly as it did. */}
          <CardTitle className="text-2xl"><h1>{t.auth.login_title}</h1></CardTitle>
          <CardDescription>{t.auth.login_desc}</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <ExpiredLinkNotice message={t.account.link_invalid} />
          </Suspense>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t.auth.email}</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t.auth.password}</Label>
              {/* autoComplete is what a password manager and a phone keyboard
                  read to offer the saved credentials for this site. */}
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
              <Link href="/forgot-password" className="inline-block text-sm text-primary underline underline-offset-4">
                {t.account.forgot_link}
              </Link>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t.auth.signing_in : t.auth.sign_in}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground text-center mt-4">
            {t.auth.no_account} <Link href="/register" className="text-primary underline underline-offset-4">{t.auth.register_link}</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}

/**
 * /auth/callback sends an expired, used or foreign-browser email link here
 * with ?error=link. Only this notice reads the query, inside its own Suspense
 * boundary, so the rest of the page still prerenders.
 */
function ExpiredLinkNotice({ message }: { message: string }) {
  const params = useSearchParams()
  if (params.get('error') !== 'link') return null
  return <p role="alert" className="mb-4 text-sm text-destructive">{message}</p>
}
