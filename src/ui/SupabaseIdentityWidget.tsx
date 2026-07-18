import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  createSupabaseBrowserClient,
  type SupabaseBrowserClient,
} from '../integrations/supabase/client'
import {
  clientPlayerIdentityFromProfile,
  clientPlayerIdentityFromAuthUser,
  SupabaseIdentityRepository,
  type ClientPlayerIdentity,
  type PlayerProfileRow,
} from '../integrations/supabase/identityRepository'

interface SupabaseIdentityWidgetProps {
  clientFactory?: () => SupabaseBrowserClient | null
  repositoryFactory?: (client: SupabaseBrowserClient) => SupabaseIdentityRepository
  onIdentityChange?: (identity: ClientPlayerIdentity | null) => void
  onIdentityLoading?: () => void
}

type RequestStatus = 'idle' | 'loading'

const defaultRepositoryFactory = (client: SupabaseBrowserClient) => new SupabaseIdentityRepository(client)
const ignoreIdentityChange = () => {}
const ignoreIdentityLoading = () => {}

export function SupabaseIdentityWidget({
  clientFactory = createSupabaseBrowserClient,
  repositoryFactory = defaultRepositoryFactory,
  onIdentityChange = ignoreIdentityChange,
  onIdentityLoading = ignoreIdentityLoading,
}: SupabaseIdentityWidgetProps) {
  const client = useMemo(() => clientFactory(), [clientFactory])
  const repository = useMemo(() => (client ? repositoryFactory(client) : null), [client, repositoryFactory])
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<PlayerProfileRow | null>(null)
  const [email, setEmail] = useState('')
  const [screenName, setScreenName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [visibility, setVisibility] = useState<PlayerProfileRow['visibility']>('private')
  const [status, setStatus] = useState<RequestStatus>('idle')
  const [message, setMessage] = useState(client ? 'Para identity ready.' : 'Supabase env not configured.')

  const loadProfile = useCallback(async (nextSession: Session) => {
    if (!repository) {
      return
    }

    const accountId = nextSession.user.id
    if (!accountId) {
      setMessage('Signed-in session is missing an account id.')
      return
    }

    try {
      const loadedProfile = await repository.getOwnProfile(accountId)
      setProfile(loadedProfile)
      setScreenName(loadedProfile?.screen_name ?? '')
      setAvatarUrl(loadedProfile?.avatar_url ?? '')
      setVisibility(loadedProfile?.visibility ?? 'private')
      if (loadedProfile) {
        onIdentityChange(clientPlayerIdentityFromProfile(loadedProfile))
      } else {
        const authIdentity = clientPlayerIdentityFromAuthUser(nextSession.user)
        if (authIdentity) {
          setScreenName(authIdentity.screenName)
          setAvatarUrl(authIdentity.avatarUrl ?? '')
          onIdentityChange(authIdentity)
          setMessage('Signed in with your saved Para identity.')
        } else {
          onIdentityLoading()
          setMessage('Signed in. Create your local Para profile shell.')
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [onIdentityChange, onIdentityLoading, repository])

  useEffect(() => {
    if (!client) {
      onIdentityChange(null)
      return
    }

    let mounted = true
    void client.auth.getSession().then(({ data, error }) => {
      if (!mounted) {
        return
      }
      setSession(data.session)
      if (error) {
        setMessage(error.message)
      }
      if (data.session) {
        onIdentityLoading()
        void loadProfile(data.session)
      } else {
        onIdentityChange(null)
      }
    })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setProfile(null)
      setMessage(nextSession ? 'Signed in to Para identity.' : 'Signed out.')
      if (nextSession) {
        onIdentityLoading()
        void loadProfile(nextSession)
      } else {
        onIdentityChange(null)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [client, loadProfile, onIdentityChange, onIdentityLoading])

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!client) {
      setMessage('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to sign in.')
      return
    }

    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setMessage('Enter an email address.')
      return
    }

    setStatus('loading')
    const { error } = await client.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: window.location.origin,
      },
    })
    setStatus('idle')
    setMessage(error ? error.message : 'Check your email for the sign-in link.')
  }

  async function signOut() {
    if (!client) {
      return
    }

    setStatus('loading')
    const { error } = await client.auth.signOut()
    setStatus('idle')
    if (error) {
      setMessage(error.message)
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!client || !repository || !session?.user.id) {
      setMessage('Sign in before saving a profile.')
      return
    }

    setStatus('loading')
    try {
      const normalizedName = screenName.trim()
      const normalizedAvatarUrl = avatarUrl.trim() || null
      if (normalizedName.length < 3 || normalizedName.length > 32) {
        throw new Error('Screen name must be between 3 and 32 characters.')
      }
      const { data, error } = await client.auth.updateUser({
        data: {
          display_name: normalizedName,
          avatar_url: normalizedAvatarUrl,
        },
      })
      if (error) {
        throw new Error(error.message)
      }
      const authIdentity = data.user ? clientPlayerIdentityFromAuthUser(data.user) : null
      if (!authIdentity) {
        throw new Error('Supabase did not return the saved player identity.')
      }

      try {
        const savedProfile = await repository.upsertOwnProfile({
          accountId: session.user.id,
          email: session.user.email,
          screenName: normalizedName,
          avatarUrl: normalizedAvatarUrl,
          visibility,
        })
        setProfile(savedProfile)
        setVisibility(savedProfile.visibility)
        onIdentityChange(clientPlayerIdentityFromProfile(savedProfile))
        setMessage('Profile saved. Seat ownership still requires table authority binding.')
      } catch {
        setProfile(null)
        onIdentityChange(authIdentity)
        setMessage('Screen name saved. Public profile synchronization is currently unavailable.')
      }
      setScreenName(authIdentity.screenName)
      setAvatarUrl(authIdentity.avatarUrl ?? '')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setStatus('idle')
    }
  }

  const currentEmail = session?.user.email ?? 'Signed in'
  const accountLabel = profile?.screen_name || (session ? currentEmail : 'Guest')

  return (
    <section className="identity-widget" aria-label="Para identity">
      <details className="identity-menu-details">
        <summary aria-label="Account menu">
          <span className={`identity-status-dot ${session ? 'online' : ''}`} aria-hidden="true" />
          <span className="identity-summary-copy">
            <strong>{accountLabel}</strong>
            <small>{session ? 'Player profile' : 'Local guest'}</small>
          </span>
          <span className="identity-chevron" aria-hidden="true">+</span>
        </summary>
        <div className="identity-menu-panel">
          {session ? (
            <div className="identity-account-shell">
              <div className="identity-account-summary">
                <span>{profile?.screen_name ? currentEmail : 'Authenticated account'}</span>
                <button type="button" onClick={() => void signOut()} disabled={status === 'loading'}>
                  Sign out
                </button>
              </div>
              <details className="identity-profile-details">
                <summary>Profile</summary>
                <form className="identity-profile-form" onSubmit={(event) => void saveProfile(event)} aria-label="Player profile shell">
                  <label>
                    <span>Screen name</span>
                    <input
                      aria-label="Player screen name"
                      value={screenName}
                      onChange={(event) => setScreenName(event.target.value)}
                      disabled={status === 'loading'}
                      minLength={3}
                      maxLength={32}
                    />
                  </label>
                  <label>
                    <span>Avatar URL</span>
                    <input
                      aria-label="Player avatar URL"
                      value={avatarUrl}
                      onChange={(event) => setAvatarUrl(event.target.value)}
                      disabled={status === 'loading'}
                    />
                  </label>
                  <label>
                    <span>Visibility</span>
                    <select
                      aria-label="Player profile visibility"
                      value={visibility}
                      onChange={(event) => setVisibility(event.target.value as PlayerProfileRow['visibility'])}
                      disabled={status === 'loading'}
                    >
                      <option value="private">Private</option>
                      <option value="public">Public</option>
                    </select>
                  </label>
                  <button type="submit" disabled={status === 'loading'}>
                    Save profile
                  </button>
                </form>
              </details>
            </div>
          ) : (
            <form onSubmit={(event) => void submitEmail(event)}>
              <label>
                <span>Sign in by email</span>
                <input
                  aria-label="Para identity email"
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={!client || status === 'loading'}
                />
              </label>
              <button type="submit" disabled={!client || status === 'loading'}>
                Send link
              </button>
            </form>
          )}
          <p>{message}</p>
        </div>
      </details>
    </section>
  )
}
