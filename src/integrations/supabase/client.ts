import { createClient } from '@supabase/supabase-js'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

export interface SupabasePublicConfig {
  url?: string
  publishableKey?: string
}

export interface SupabaseAuthError {
  message: string
}

export interface SupabaseAuthApi {
  getSession: () => Promise<{ data: { session: Session | null }; error: SupabaseAuthError | null }>
  onAuthStateChange: (
    callback: (event: AuthChangeEvent, session: Session | null) => void,
  ) => { data: { subscription: { unsubscribe: () => void } } }
  signInWithOtp: (input: {
    email: string
    options?: { emailRedirectTo?: string }
  }) => Promise<{ error: SupabaseAuthError | null }>
  signOut: () => Promise<{ error: SupabaseAuthError | null }>
}

export interface SupabaseBrowserClient {
  auth: SupabaseAuthApi
  from: (table: string) => SupabaseQueryBuilder
}

export interface SupabaseQueryResult<T> {
  data: T | null
  error: SupabaseAuthError | null
}

export interface SupabaseQueryBuilder {
  select: (columns?: string) => SupabaseQueryBuilder
  insert: (values: unknown) => SupabaseQueryBuilder
  upsert: (values: unknown, options?: { onConflict?: string }) => SupabaseQueryBuilder
  update: (values: unknown) => SupabaseQueryBuilder
  eq: (column: string, value: unknown) => SupabaseQueryBuilder
  order: (column: string, options?: { ascending?: boolean }) => SupabaseQueryBuilder
  limit: (count: number) => SupabaseQueryBuilder
  maybeSingle: <T>() => Promise<SupabaseQueryResult<T>>
  single: <T>() => Promise<SupabaseQueryResult<T>>
  then: <TResult1 = SupabaseQueryResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: SupabaseQueryResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => PromiseLike<TResult1 | TResult2>
}

export function getSupabasePublicConfig(env: Partial<ImportMetaEnv> = import.meta.env): SupabasePublicConfig {
  return {
    url: env.VITE_SUPABASE_URL?.trim(),
    publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim(),
  }
}

export function isSupabaseConfigured(config: SupabasePublicConfig): config is Required<SupabasePublicConfig> {
  return Boolean(config.url && config.publishableKey)
}

export function createSupabaseBrowserClient(
  config: SupabasePublicConfig = getSupabasePublicConfig(),
): SupabaseBrowserClient | null {
  if (!isSupabaseConfigured(config)) {
    return null
  }

  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }) as unknown as SupabaseBrowserClient
}
