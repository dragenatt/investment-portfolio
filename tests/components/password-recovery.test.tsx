import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import es from '@/app/dictionaries/es.json'

const auth = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn(), getUser: vi.fn(), updateUser: vi.fn() }))
const push = vi.fn()
const query = vi.hoisted(() => ({ current: '' }))

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query.current),
}))
vi.mock('@/lib/i18n', () => ({ useTranslation: () => ({ t: es, locale: 'es' }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const { default: ForgotPasswordPage } = await import('@/app/(auth)/forgot-password/page')
const { default: ResetPasswordPage } = await import('@/app/(auth)/reset-password/page')
const { default: LoginPage } = await import('@/app/(auth)/login/page')

beforeEach(() => {
  Object.values(auth).forEach((fn) => fn.mockReset())
  push.mockReset()
})

describe('/forgot-password', () => {
  function submit(email: string) {
    fireEvent.change(screen.getByLabelText(es.auth.email), { target: { value: email } })
    fireEvent.click(screen.getByRole('button', { name: es.account.forgot_submit }))
  }

  it('sends the link back through the route that exchanges it', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    render(<ForgotPasswordPage />)

    submit('someone@example.com')

    await screen.findByText(es.account.forgot_sent)
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('someone@example.com', {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
  })

  it('says the same thing whether or not the address has an account', async () => {
    // Supabase answers an unknown address like a known one; so does the page.
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { code: 'user_not_found', status: 400 } })
    render(<ForgotPasswordPage />)

    submit('nobody@example.com')

    await screen.findByText(es.account.forgot_sent)
  })

  it('asks for patience when Supabase refuses to send more', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { code: 'over_email_send_rate_limit', status: 429 } })
    render(<ForgotPasswordPage />)

    submit('someone@example.com')

    await screen.findByText(es.account.rate_limited)
    expect(screen.queryByText(es.account.forgot_sent)).not.toBeInTheDocument()
  })
})

describe('/reset-password', () => {
  it('explains how to get a new link when there is no session to set a password on', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } })
    render(<ResetPasswordPage />)

    await screen.findByText(es.account.link_invalid)
    expect(screen.getByRole('link', { name: es.account.request_new_link })).toHaveAttribute('href', '/forgot-password')
  })

  it('checks the two passwords agree before asking Supabase', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    render(<ResetPasswordPage />)

    fireEvent.change(await screen.findByLabelText(es.account.new_password), { target: { value: 'abcdef1' } })
    fireEvent.change(screen.getByLabelText(es.account.confirm_password), { target: { value: 'abcdef2' } })
    fireEvent.click(screen.getByRole('button', { name: es.account.save_password }))

    await screen.findByText(es.account.passwords_dont_match)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('saves the password and continues into the app', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    render(<ResetPasswordPage />)

    fireEvent.change(await screen.findByLabelText(es.account.new_password), { target: { value: 'abcdef1' } })
    fireEvent.change(screen.getByLabelText(es.account.confirm_password), { target: { value: 'abcdef1' } })
    fireEvent.click(screen.getByRole('button', { name: es.account.save_password }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'abcdef1' })
  })

  it('names the reason Supabase refused the new password', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    auth.updateUser.mockResolvedValue({ data: null, error: { code: 'same_password', status: 422 } })
    render(<ResetPasswordPage />)

    fireEvent.change(await screen.findByLabelText(es.account.new_password), { target: { value: 'abcdef1' } })
    fireEvent.change(screen.getByLabelText(es.account.confirm_password), { target: { value: 'abcdef1' } })
    fireEvent.click(screen.getByRole('button', { name: es.account.save_password }))

    await screen.findByText(es.account.same_password)
    expect(push).not.toHaveBeenCalled()
  })
})

describe('/login', () => {
  it('offers the way back in to someone who forgot the password', () => {
    query.current = ''
    render(<LoginPage />)

    expect(screen.getByRole('link', { name: es.account.forgot_link })).toHaveAttribute('href', '/forgot-password')
    expect(screen.queryByText(es.account.link_invalid)).not.toBeInTheDocument()
  })

  it('says why an email link brought them here instead of where it promised', () => {
    query.current = 'error=link'
    render(<LoginPage />)

    expect(screen.getByRole('alert')).toHaveTextContent(es.account.link_invalid)
  })
})
