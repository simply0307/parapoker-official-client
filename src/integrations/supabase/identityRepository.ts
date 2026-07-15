import type { AuthorityClass, ArchiveLifecycleStatus, SubmissionLifecycleStatus, TableLifecycleStatus } from '../../persistence'
import type { SupabaseBrowserClient, SupabaseQueryResult } from './client'

export interface PlayerProfileRow {
  id: string
  account_id: string
  screen_name: string
  avatar_url: string | null
  visibility: 'private' | 'public'
  created_at: string
  updated_at: string
}

export interface PlayerProfileDraft {
  accountId: string
  screenName: string
  avatarUrl?: string | null
  visibility?: PlayerProfileRow['visibility']
}

export interface ClientPlayerIdentity {
  profileId: string
  accountId: string
  screenName: string
  avatarUrl: string | null
}

export interface RestrictedArchiveMetadataRow {
  archive_id: string
  table_id: string
  match_id: string
  authority_class: AuthorityClass
  table_lifecycle_status: TableLifecycleStatus
  archive_lifecycle_status: ArchiveLifecycleStatus
  submission_lifecycle_status: SubmissionLifecycleStatus
  owner_account_id: string | null
  storage_bucket: string
  storage_path: string
  checksum: string
  created_at: string
  closed_at: string | null
  imported_at: string | null
}

export class SupabaseIdentityRepository {
  private readonly client: SupabaseBrowserClient

  constructor(client: SupabaseBrowserClient) {
    this.client = client
  }

  async getOwnProfile(accountId: string): Promise<PlayerProfileRow | null> {
    const { data, error } = await this.client
      .from('player_profiles')
      .select('id, account_id, screen_name, avatar_url, visibility, created_at, updated_at')
      .eq('account_id', accountId)
      .maybeSingle<PlayerProfileRow>()
    throwIfError(error)
    return data
  }

  async upsertOwnProfile(profile: PlayerProfileDraft): Promise<PlayerProfileRow> {
    const normalized = normalizeProfileDraft(profile)
    const { data, error } = await this.client
      .from('player_profiles')
      .upsert({
        account_id: normalized.accountId,
        screen_name: normalized.screenName,
        avatar_url: normalized.avatarUrl,
        visibility: normalized.visibility,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'account_id' })
      .select('id, account_id, screen_name, avatar_url, visibility, created_at, updated_at')
      .single<PlayerProfileRow>()
    throwIfError(error)
    if (!data) {
      throw new Error('Supabase profile upsert returned no profile row.')
    }
    return data
  }

  async listOwnArchiveMetadata(accountId: string): Promise<RestrictedArchiveMetadataRow[]> {
    const result = await this.client
      .from('restricted_archive_metadata')
      .select('archive_id, table_id, match_id, authority_class, table_lifecycle_status, archive_lifecycle_status, submission_lifecycle_status, owner_account_id, storage_bucket, storage_path, checksum, created_at, closed_at, imported_at')
      .eq('owner_account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100) as SupabaseQueryResult<RestrictedArchiveMetadataRow[]>
    throwIfError(result.error)
    return result.data ?? []
  }
}

export function normalizeProfileDraft(profile: PlayerProfileDraft): Required<PlayerProfileDraft> {
  const screenName = profile.screenName.trim()
  if (screenName.length < 3 || screenName.length > 32) {
    throw new Error('Screen name must be between 3 and 32 characters.')
  }
  return {
    accountId: profile.accountId,
    screenName,
    avatarUrl: profile.avatarUrl ?? null,
    visibility: profile.visibility ?? 'private',
  }
}

export function clientPlayerIdentityFromProfile(profile: PlayerProfileRow): ClientPlayerIdentity {
  return {
    profileId: profile.id,
    accountId: profile.account_id,
    screenName: profile.screen_name,
    avatarUrl: profile.avatar_url,
  }
}

function throwIfError(error: { message: string } | null): void {
  if (error) {
    throw new Error(error.message)
  }
}
