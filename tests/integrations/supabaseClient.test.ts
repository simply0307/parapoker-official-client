import { describe, expect, it } from 'vitest'
import {
  createSupabaseBrowserClient,
  getSupabasePublicConfig,
  isSupabaseConfigured,
} from '../../src/integrations/supabase/client'

describe('Supabase browser client boundary', () => {
  it('reads only public Vite Supabase env values', () => {
    const config = getSupabasePublicConfig({
      VITE_SUPABASE_URL: ' https://example.supabase.co ',
      VITE_SUPABASE_PUBLISHABLE_KEY: ' publishable-key ',
    })

    expect(config).toEqual({
      url: 'https://example.supabase.co',
      publishableKey: 'publishable-key',
    })
    expect(isSupabaseConfigured(config)).toBe(true)
  })

  it('stays disabled when the publishable config is incomplete', () => {
    expect(createSupabaseBrowserClient({})).toBeNull()
    expect(createSupabaseBrowserClient({ url: 'https://example.supabase.co' })).toBeNull()
    expect(createSupabaseBrowserClient({ publishableKey: 'publishable-key' })).toBeNull()
  })

  it('reuses one auth client per public configuration', () => {
    const config = {
      url: 'https://singleton-test.supabase.co',
      publishableKey: 'publishable-singleton-test-key',
    }

    expect(createSupabaseBrowserClient(config)).toBe(createSupabaseBrowserClient(config))
  })
})
