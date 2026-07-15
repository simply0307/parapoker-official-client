import { describe, expect, it } from 'vitest'
import {
  normalizeProfileDraft,
  SupabaseIdentityRepository,
  type PlayerProfileRow,
  type RestrictedArchiveMetadataRow,
} from '../../src/integrations/supabase/identityRepository'
import type { SupabaseBrowserClient, SupabaseQueryBuilder, SupabaseQueryResult } from '../../src/integrations/supabase/client'

describe('Supabase identity repository boundary', () => {
  it('normalizes player profile drafts before writing through RLS-protected tables', () => {
    expect(normalizeProfileDraft({
      accountId: 'account-1',
      screenName: '  RiverPort  ',
    })).toEqual({
      accountId: 'account-1',
      email: null,
      screenName: 'RiverPort',
      avatarUrl: null,
      visibility: 'private',
    })
    expect(() => normalizeProfileDraft({ accountId: 'account-1', screenName: 'ab' })).toThrow('Screen name')
  })

  it('adapts the deployed profiles table into the client player identity surface', async () => {
    const profile: PlayerProfileRow = {
      id: 'account-1',
      account_id: 'account-1',
      screen_name: 'RiverPort',
      avatar_url: null,
      visibility: 'private',
      created_at: '2026-07-15T12:00:00.000Z',
      updated_at: '2026-07-15T12:00:00.000Z',
    }
    const client = createMockClient({
      profiles: {
        id: 'account-1',
        display_name: 'RiverPort',
        email: 'player@example.com',
        created_at: '2026-07-15T12:00:00.000Z',
        updated_at: '2026-07-15T12:00:00.000Z',
      },
    })
    const repository = new SupabaseIdentityRepository(client)

    await expect(repository.getOwnProfile('account-1')).resolves.toEqual(profile)
    await expect(repository.upsertOwnProfile({
      accountId: 'account-1',
      screenName: 'RiverPort',
      visibility: 'private',
    })).resolves.toEqual(profile)

    expect(client.calls).toContainEqual(expect.objectContaining({
      table: 'profiles',
      operation: 'eq',
      args: ['id', 'account-1'],
    }))
    expect(client.calls).toContainEqual(expect.objectContaining({
      table: 'profiles',
      operation: 'upsert',
    }))
    expect(JSON.stringify(client.calls)).not.toContain('service_role')
    expect(JSON.stringify(client.calls)).not.toContain('SERVICE_ROLE')
  })

  it('lists only archive metadata rows owned by the current account and never storage objects', async () => {
    const metadata: RestrictedArchiveMetadataRow[] = [{
      archive_id: 'archive-1',
      table_id: 'table-1',
      match_id: 'match-1',
      authority_class: 'local-browser',
      table_lifecycle_status: 'closed',
      archive_lifecycle_status: 'ready',
      submission_lifecycle_status: 'not-submitted',
      owner_account_id: 'account-1',
      storage_bucket: 'parapoker-restricted-archives',
      storage_path: 'account-1/archive-1.json.gz',
      checksum: 'abc123',
      created_at: '2026-07-15T12:00:00.000Z',
      closed_at: null,
      imported_at: null,
    }]
    const client = createMockClient({
      restricted_archive_metadata: metadata,
    })
    const repository = new SupabaseIdentityRepository(client)

    await expect(repository.listOwnArchiveMetadata('account-1')).resolves.toEqual(metadata)

    expect(client.calls).toContainEqual(expect.objectContaining({
      table: 'restricted_archive_metadata',
      operation: 'eq',
      args: ['owner_account_id', 'account-1'],
    }))
    expect(client.calls.some((call) => call.table === 'storage.objects')).toBe(false)
  })
})

type TableData = Record<string, unknown>

function createMockClient(dataByTable: TableData): SupabaseBrowserClient & { calls: Array<{ table: string; operation: string; args: unknown[] }> } {
  const calls: Array<{ table: string; operation: string; args: unknown[] }> = []
  return {
    calls,
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signInWithOtp: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
      updateUser: async () => ({ data: { user: null }, error: null }),
    },
    from(table: string) {
      return createBuilder(table, dataByTable[table] ?? null, calls)
    },
  }
}

function createBuilder(
  table: string,
  tableData: unknown,
  calls: Array<{ table: string; operation: string; args: unknown[] }>,
): SupabaseQueryBuilder {
  const builder: SupabaseQueryBuilder = {
    select: (...args) => {
      calls.push({ table, operation: 'select', args })
      return builder
    },
    insert: (...args) => {
      calls.push({ table, operation: 'insert', args })
      return builder
    },
    upsert: (...args) => {
      calls.push({ table, operation: 'upsert', args })
      return builder
    },
    update: (...args) => {
      calls.push({ table, operation: 'update', args })
      return builder
    },
    eq: (...args) => {
      calls.push({ table, operation: 'eq', args })
      return builder
    },
    order: (...args) => {
      calls.push({ table, operation: 'order', args })
      return builder
    },
    limit: (...args) => {
      calls.push({ table, operation: 'limit', args })
      return builder
    },
    maybeSingle: async <T>() => ({ data: tableData as T, error: null }),
    single: async <T>() => ({ data: tableData as T, error: null }),
    then: (onfulfilled, onrejected) => Promise.resolve({ data: tableData, error: null } as SupabaseQueryResult<unknown>).then(onfulfilled, onrejected),
  }
  return builder
}
