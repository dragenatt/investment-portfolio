import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { AccountSecurity } from '@/components/settings/account-security'
import es from '@/app/dictionaries/es.json'

// Settings had no way to change the password, the email was a disabled field,
// an account could not be closed, and the only sign-out ended every session.

const auth = vi.hoisted(() => ({ signOut: vi.fn(), signInWithPassword: vi.fn(), updateUser: vi.fn() }))
const push = vi.fn()
const clearOfflineUserData = vi.fn()
const EMAIL = 'someone@example.com'

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('@/lib/pwa/offline-data', () => ({ clearOfflineUserData: () => clearOfflineUserData() }))
vi.mock('@/lib/i18n', () => ({ useTranslation: () => ({ t: es, locale: 'es' }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

beforeEach(() => {
  Object.values(auth).forEach((fn) => fn.mockReset())
  push.mockReset()
  clearOfflineUserData.mockReset()
  vi.unstubAllGlobals()
})

function type(label: string, value: string, scope: Pick<typeof screen, 'getByLabelText'> = screen) {
  fireEvent.change(scope.getByLabelText(label), { target: { value } })
}

describe('AccountSecurity — sign out everywhere', () => {
  it('asks first, then ends every session and clears what this device saved', async () => {
    auth.signOut.mockResolvedValue({ error: null })
    render(<AccountSecurity email={EMAIL} />)

    fireEvent.click(screen.getByRole('button', { name: es.account.sign_out_everywhere }))
    expect(auth.signOut).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: es.account.sign_out_everywhere }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' })
    expect(clearOfflineUserData).toHaveBeenCalled()
  })

  it('stays put and says so when the revocation fails', async () => {
    auth.signOut.mockResolvedValue({ error: new Error('network') })
    render(<AccountSecurity email={EMAIL} />)

    fireEvent.click(screen.getByRole('button', { name: es.account.sign_out_everywhere }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: es.account.sign_out_everywhere }))

    await waitFor(() => expect(auth.signOut).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
    expect(clearOfflineUserData).not.toHaveBeenCalled()
  })
})

describe('AccountSecurity — change password', () => {
  function fill(current: string, next: string, confirmation = next) {
    type(es.account.current_password, current)
    type(es.account.new_password, next)
    type(es.account.confirm_password, confirmation)
    fireEvent.click(screen.getByRole('button', { name: es.account.change_password }))
  }

  it('checks the current password before changing it', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    render(<AccountSecurity email={EMAIL} />)

    fill('old-secret', 'new-secret')

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-secret' }))
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: 'old-secret' })
  })

  it('changes nothing when the current password is wrong', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', status: 400 } })
    render(<AccountSecurity email={EMAIL} />)

    fill('guess', 'new-secret')

    await screen.findByText(es.account.wrong_current_password)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
})

describe('AccountSecurity — change email', () => {
  it('asks Supabase to confirm the new address and returns through the callback', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    render(<AccountSecurity email={EMAIL} />)

    type(es.account.new_email, 'new@example.com')
    fireEvent.click(screen.getByRole('button', { name: es.account.send_confirmation }))

    await screen.findByText(es.account.email_change_sent.replace('{email}', 'new@example.com'))
    expect(auth.updateUser).toHaveBeenCalledWith(
      { email: 'new@example.com' },
      { emailRedirectTo: `${window.location.origin}/auth/callback?next=/settings` },
    )
  })

  it('does not send anything for the address the account already has', async () => {
    render(<AccountSecurity email={EMAIL} />)

    type(es.account.new_email, 'SOMEONE@example.com')
    fireEvent.click(screen.getByRole('button', { name: es.account.send_confirmation }))

    await screen.findByText(es.account.same_email)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
})

describe('AccountSecurity — delete account', () => {
  async function openDialog() {
    render(<AccountSecurity email={EMAIL} />)
    fireEvent.click(screen.getByRole('button', { name: es.account.delete_account }))
    return screen.findByRole('dialog')
  }

  it('cannot be confirmed without the password and the typed word', async () => {
    const dialog = await openDialog()
    const confirm = within(dialog).getByRole('button', { name: es.account.delete_account_submit })

    expect(confirm).toBeDisabled()
    type(es.account.current_password, 'secret', within(dialog))
    expect(confirm).toBeDisabled()
    type(es.account.delete_account_word_label.replace('{word}', es.account.delete_account_word), 'eliminar', within(dialog))
    expect(confirm).toBeEnabled()
  })

  it('reports a wrong password without leaving the dialog', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetchMock)
    const dialog = await openDialog()

    type(es.account.current_password, 'guess', within(dialog))
    type(es.account.delete_account_word_label.replace('{word}', es.account.delete_account_word), es.account.delete_account_word, within(dialog))
    fireEvent.click(within(dialog).getByRole('button', { name: es.account.delete_account_submit }))

    await within(dialog).findByText(es.account.wrong_current_password)
    expect(fetchMock).toHaveBeenCalledWith('/api/user/account', expect.objectContaining({ method: 'DELETE' }))
    expect(clearOfflineUserData).not.toHaveBeenCalled()
  })
})
