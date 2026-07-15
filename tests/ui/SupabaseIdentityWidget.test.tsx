import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseBrowserClient } from '../../src/integrations/supabase/client'
import type { PlayerProfileRow } from '../../src/integrations/supabase/identityRepository'
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
    const session = { user: { id: 'account-1', email: 'player@example.com' } } as Session
    const { client, signOut } = createClientMock(session)
    const repository = createRepositoryMock(null)
    render(<SupabaseIdentityWidget clientFactory={() => client} repositoryFactory={() => repository} />)

    expect(await screen.findByText('player@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(signOut).toHaveBeenCalled()
    })
  })

  it('loads and saves the signed-in player profile shell without binding seat authority', async () => {
    const session = { user: { id: 'account-1', email: 'player@example.com' } } as Session
    const { client } = createClientMock(session)
    const repository = createRepositoryMock({
      id: 'profile-1',
      account_id: 'account-1',
      screen_name: 'RiverPort',
      avatar_url: null,
      visibility: 'private',
      created_at: '2026-07-15T12:00:00.000Z',
      updated_at: '2026-07-15T12:00:00.000Z',
    })
    render(<SupabaseIdentityWidget clientFactory={() => client} repositoryFactory={() => repository} />)

    expect(await screen.findByText('RiverPort')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Profile'))
    fireEvent.change(screen.getByLabelText('Player screen name'), {
      target: { value: 'RiverCoach' },
    })
    fireEvent.change(screen.getByLabelText('Player avatar URL'), {
      target: { value: 'https://example.com/avatar.png' },
    })
    fireEvent.change(screen.getByLabelText('Player profile visibility'), {
      target: { value: 'public' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => {
      expect(repository.upsertOwnProfile).toHaveBeenCalledWith({
        accountId: 'account-1',
        screenName: 'RiverCoach',
        avatarUrl: 'https://example.com/avatar.png',
        visibility: 'public',
      })
    })
    expect(screen.getByText('Profile saved. Seat ownership still requires table authority binding.')).toBeInTheDocument()
  })

  it('keeps the default repository factory stable after a signed-in profile render', async () => {
    const session = { user: { id: 'account-1', email: 'player@example.com' } } as Session
    const { client, getSession, onAuthStateChange } = createClientMock(session, {
      player_profiles: {
        id: 'profile-1',
        account_id: 'account-1',
        screen_name: 'StableRiver',
        avatar_url: null,
        visibility: 'private',
        created_at: '2026-07-15T12:00:00.000Z',
        updated_at: '2026-07-15T12:00:00.000Z',
      },
    })

    render(<SupabaseIdentityWidget clientFactory={() => client} />)

    expect(await screen.findByText('StableRiver')).toBeInTheDocument()
    await waitFor(() => {
      expect(getSession).toHaveBeenCalledTimes(1)
      expect(onAuthStateChange).toHaveBeenCalledTimes(1)
    })
  })
})

function createClientMock(initialSession: Session | null = null, dataByTable: Record<string, unknown> = {}) {
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
    from(table: string) {
      return createQueryBuilder(dataByTable[table] ?? null)
    },
  } as unknown as SupabaseBrowserClient

  return { client, getSession, onAuthStateChange, signInWithOtp, signOut, unsubscribe }
}

function createQueryBuilder(tableData: unknown) {
  const builder = {
    select: () => builder,
    insert: () => builder,
    upsert: () => builder,
    update: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: tableData, error: null }),
    single: async () => ({ data: tableData, error: null }),
    then: (onfulfilled: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: tableData, error: null }).then(onfulfilled, onrejected),
  }
  return builder
}

function createRepositoryMock(initialProfile: PlayerProfileRow | null) {
  const getOwnProfile = vi.fn(async () => initialProfile)
  const upsertOwnProfile = vi.fn(async (draft: {
    accountId: string
    screenName: string
    avatarUrl?: string | null
    visibility?: PlayerProfileRow['visibility']
  }) => ({
    id: initialProfile?.id ?? 'profile-1',
    account_id: draft.accountId,
    screen_name: draft.screenName,
    avatar_url: draft.avatarUrl ?? null,
    visibility: draft.visibility ?? 'private',
    created_at: initialProfile?.created_at ?? '2026-07-15T12:00:00.000Z',
    updated_at: '2026-07-15T12:05:00.000Z',
  }))
  return {
    getOwnProfile,
    upsertOwnProfile,
  }
}
