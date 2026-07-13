import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseBrowserClient } from '../../src/integrations/supabase/client'
import { SupabaseIdentityWidget } from '../../src/ui/SupabaseIdentityWidget'

describe('SupabaseIdentityWidget', () => {
  it('shows a disabled identity control when Supabase env is missing', () => {
    render(<SupabaseIdentityWidget clientFactory={() => null} />)

    expect(screen.getByLabelText('Para identity email')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send link' })).toBeDisabled()
    expect(screen.getByText('Supabase env not configured.')).toBeInTheDocument()
  })

  it('submits an email magic-link request through the Supabase client', async () => {
    const { client, signInWithOtp } = createClientMock()
    render(<SupabaseIdentityWidget clientFactory={() => client} />)

    fireEvent.change(screen.getByLabelText('Para identity email'), {
      target: { value: 'player@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }))

    await waitFor(() => {
      expect(signInWithOtp).toHaveBeenCalledWith({
        email: 'player@example.com',
        options: {
          emailRedirectTo: 'http://localhost:3000',
        },
      })
    })
    expect(screen.getByText('Check your email for the sign-in link.')).toBeInTheDocument()
  })

  it('shows the signed-in email and signs out through the Supabase client', async () => {
    const session = { user: { email: 'player@example.com' } } as Session
    const { client, signOut } = createClientMock(session)
    render(<SupabaseIdentityWidget clientFactory={() => client} />)

    expect(await screen.findByText('player@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(signOut).toHaveBeenCalled()
    })
  })
})

function createClientMock(initialSession: Session | null = null) {
  const signInWithOtp = vi.fn(async () => ({ error: null }))
  const signOut = vi.fn(async () => ({ error: null }))
  const getSession = vi.fn(async () => ({ data: { session: initialSession }, error: null }))
  const unsubscribe = vi.fn()
  const onAuthStateChange = vi.fn(() => ({
    data: { subscription: { unsubscribe } },
  }))

  const client = {
    auth: {
      getSession,
      onAuthStateChange,
      signInWithOtp,
      signOut,
    },
  } as unknown as SupabaseBrowserClient

  return { client, getSession, onAuthStateChange, signInWithOtp, signOut, unsubscribe }
}
