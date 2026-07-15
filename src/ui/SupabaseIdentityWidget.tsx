import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  createSupabaseBrowserClient,
  type SupabaseBrowserClient,
} from '../integrations/supabase/client'
import {
  SupabaseIdentityRepository,
  type PlayerProfileRow,
} from '../integrations/supabase/identityRepository'

interface SupabaseIdentityWidgetProps {
  clientFactory?: () => SupabaseBrowserClient | null
  repositoryFactory?: (client: SupabaseBrowserClient) => SupabaseIdentityRepository
}

type RequestStatus = 'idle' | 'loading'

export function SupabaseIdentityWidget({
  clientFactory = createSupabaseBrowserClient,
  repositoryFactory = (client) => new SupabaseIdentityRepository(client),
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
      if (!loadedProfile) {
        setMessage('Signed in. Create your local Para profile shell.')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [repository])

  useEffect(() => {
    if (!client) {
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
        void loadProfile(data.session)
      }
    })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setProfile(null)
      setMessage(nextSession ? 'Signed in to Para identity.' : 'Signed out.')
      if (nextSession) {
        void loadProfile(nextSession)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [client, loadProfile])

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
    if (!repository || !session?.user.id) {
      setMessage('Sign in before saving a profile.')
      return
    }

    setStatus('loading')
    try {
      const savedProfile = await repository.upsertOwnProfile({
        accountId: session.user.id,
        screenName,
        avatarUrl: avatarUrl.trim() || null,
        visibility,
      })
      setProfile(savedProfile)
      setScreenName(savedProfile.screen_name)
      setAvatarUrl(savedProfile.avatar_url ?? '')
      setVisibility(savedProfile.visibility)
      setMessage('Profile saved. Seat ownership still requires table authority binding.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setStatus('idle')
    }
  }

  const currentEmail = session?.user.email ?? 'Signed in'

  return (
    <section className="identity-widget" aria-label="Para identity">
      {session ? (
        <div className="identity-account-shell">
          <div className="identity-account-summary">
            <span>{profile?.screen_name || currentEmail}</span>
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
            <span>Para identity</span>
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
    </section>
  )
}
