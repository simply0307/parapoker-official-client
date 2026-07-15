import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('sql/20260715_identity_roles_restricted_archives_v1.sql', 'utf8')

describe('Supabase identity and restricted archive schema', () => {
  it('creates RLS-protected profile, operator role, and archive metadata tables', () => {
    expect(sql).toMatch(/create table if not exists public\.player_profiles/)
    expect(sql).toMatch(/create table if not exists public\.operator_roles/)
    expect(sql).toMatch(/create table if not exists public\.restricted_archive_metadata/)
    expect(sql).toMatch(/alter table public\.player_profiles enable row level security/)
    expect(sql).toMatch(/alter table public\.operator_roles enable row level security/)
    expect(sql).toMatch(/alter table public\.restricted_archive_metadata enable row level security/)
  })

  it('uses ownership predicates and operator-role predicates instead of broad authenticated access', () => {
    expect(sql).toMatch(/using \(\(select auth\.uid\(\)\) = account_id\)/)
    expect(sql).toMatch(/with check \(\(select auth\.uid\(\)\) = account_id\)/)
    expect(sql).toMatch(/using \(\(select auth\.uid\(\)\) = owner_account_id\)/)
    expect(sql).toMatch(/operator_roles\.role in \('admin', 'support', 'importer'\)/)
    expect(sql).not.toMatch(/auth\.role\(\)/)
    expect(sql).not.toMatch(/raw_user_meta_data|user_metadata/i)
    expect(sql).not.toMatch(/to authenticated\s+using\s+\(\s*true\s*\)/i)
  })

  it('creates a private restricted archive bucket without browser upload policies', () => {
    expect(sql).toMatch(/insert into storage\.buckets/)
    expect(sql).toMatch(/'parapoker-restricted-archives'/)
    expect(sql).toMatch(/public,\s*file_size_limit,\s*allowed_mime_types\)/)
    expect(sql).toMatch(/false,\s*52428800/)
    expect(sql).toMatch(/on storage\.objects\s+for select\s+to authenticated/)
    expect(sql).not.toMatch(/on storage\.objects\s+for insert\s+to authenticated/)
    expect(sql).not.toMatch(/on storage\.objects\s+for update\s+to authenticated/)
    expect(sql).not.toMatch(/service_role|service-role|secret key/i)
  })
})
