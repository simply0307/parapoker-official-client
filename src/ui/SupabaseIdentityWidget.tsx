import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  createSupabaseBrowserClient,
  type SupabaseBrowserClient,
} from '../integrations/supabase/client'

interface SupabaseIdentityWidgetProps {
  clientFactory?: () => SupabaseBrowserClient | null
}

type RequestStatus = 'idle' | 'loading'

export function SupabaseIdentityWidget({
  clientFactory = createSupabaseBrowserClient,
}: SupabaseIdentityWidgetProps) {
  const client = useMemo(() => clientFactory(), [clientFactory])
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<RequestStatus>('idle')
  const [message, setMessage] = useState(client ? 'Para identity ready.' : 'Supabase env not configured.')

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
    })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setMessage(nextSession ? 'Signed in to Para identity.' : 'Signed out.')
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [client])

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

  const currentEmail = session?.user.email ?? 'Signed in'

  return (
    <section className="identity-widget" aria-label="Para identity">
      {session ? (
        <>
          <span>{currentEmail}</span>
          <button type="button" onClick={() => void signOut()} disabled={status === 'loading'}>
            Sign out
          </button>
        </>
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
