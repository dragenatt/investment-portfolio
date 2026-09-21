import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AccountSecurity } from '@/components/settings/account-security'
import es from '@/app/dictionaries/es.json'

const signOut = vi.fn()
const push = vi.fn()
const clearOfflineUserData = vi.fn()

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut } }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('@/lib/pwa/offline-data', () => ({ clearOfflineUserData: () => clearOfflineUserData() }))
vi.mock('@/lib/i18n', () => ({ useTranslation: () => ({ t: es, locale: 'es' }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

beforeEach(() => {
  signOut.mockReset()
  push.mockReset()
  clearOfflineUserData.mockReset()
})

describe('AccountSecurity — sign out everywhere', () => {
  it('asks first, then ends every session and clears what this device saved', async () => {
    signOut.mockResolvedValue({ error: null })
    render(<AccountSecurity />)

    fireEvent.click(screen.getByRole('button', { name: es.account.sign_out_everywhere }))
    expect(signOut).not.toHaveBeenCalled()

    const buttons = await screen.findAllByRole('button', { name: es.account.sign_out_everywhere })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' })
    expect(clearOfflineUserData).toHaveBeenCalled()
  })

  it('stays put and says so when the revocation fails', async () => {
    signOut.mockResolvedValue({ error: new Error('network') })
    render(<AccountSecurity />)

    fireEvent.click(screen.getByRole('button', { name: es.account.sign_out_everywhere }))
    const buttons = await screen.findAllByRole('button', { name: es.account.sign_out_everywhere })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(signOut).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
    expect(clearOfflineUserData).not.toHaveBeenCalled()
  })
})
