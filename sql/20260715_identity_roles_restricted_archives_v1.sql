-- ParaPoker identity, operator roles, and restricted archive metadata v1.
--
-- Apply from a trusted server/admin context only. Do not run from the browser client.
-- This migration intentionally creates metadata and access-control surfaces only;
-- restricted archive JSON objects are written by a future authority/operator service.

create table if not exists public.player_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references auth.users(id) on delete cascade,
  screen_name text not null check (char_length(screen_name) between 3 and 32),
  avatar_url text,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.player_profiles enable row level security;

drop policy if exists "player profiles are readable by owner" on public.player_profiles;
create policy "player profiles are readable by owner"
on public.player_profiles
for select
to authenticated
using ((select auth.uid()) = account_id);

drop policy if exists "players can create own profile" on public.player_profiles;
create policy "players can create own profile"
on public.player_profiles
for insert
to authenticated
with check ((select auth.uid()) = account_id);

drop policy if exists "players can update own profile" on public.player_profiles;
create policy "players can update own profile"
on public.player_profiles
for update
to authenticated
using ((select auth.uid()) = account_id)
with check ((select auth.uid()) = account_id);

grant select, insert, update on public.player_profiles to authenticated;

create table if not exists public.operator_roles (
  account_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'support', 'importer')),
  granted_at timestamptz not null default now()
);

alter table public.operator_roles enable row level security;

drop policy if exists "operators can read own role marker" on public.operator_roles;
create policy "operators can read own role marker"
on public.operator_roles
for select
to authenticated
using ((select auth.uid()) = account_id);

grant select on public.operator_roles to authenticated;

create table if not exists public.restricted_archive_metadata (
  archive_id text primary key,
  table_id text not null,
  match_id text not null,
  authority_class text not null check (authority_class in ('local-browser', 'local-development', 'server-exhibition', 'server-official')),
  table_lifecycle_status text not null check (table_lifecycle_status in ('draft', 'scheduled', 'open', 'seating', 'active', 'closing', 'closed', 'cancelled', 'aborted')),
  archive_lifecycle_status text not null check (archive_lifecycle_status in ('not-started', 'journaling', 'finalizing', 'ready', 'failed', 'quarantined')),
  submission_lifecycle_status text not null default 'not-submitted' check (submission_lifecycle_status in ('not-submitted', 'csv-generated', 'submitted', 'validation-failed', 'needs-mapping', 'imported', 'rejected')),
  owner_account_id uuid references auth.users(id) on delete set null,
  storage_bucket text not null default 'parapoker-restricted-archives',
  storage_path text not null unique,
  checksum text not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  imported_at timestamptz
);

create index if not exists restricted_archive_metadata_owner_idx
on public.restricted_archive_metadata (owner_account_id, created_at desc);

create index if not exists restricted_archive_metadata_table_idx
on public.restricted_archive_metadata (table_id, created_at desc);

alter table public.restricted_archive_metadata enable row level security;

drop policy if exists "players can read own archive metadata only" on public.restricted_archive_metadata;
create policy "players can read own archive metadata only"
on public.restricted_archive_metadata
for select
to authenticated
using ((select auth.uid()) = owner_account_id);

drop policy if exists "operators can read restricted archive metadata" on public.restricted_archive_metadata;
create policy "operators can read restricted archive metadata"
on public.restricted_archive_metadata
for select
to authenticated
using (
  exists (
    select 1
    from public.operator_roles
    where operator_roles.account_id = (select auth.uid())
      and operator_roles.role in ('admin', 'support', 'importer')
  )
);

grant select on public.restricted_archive_metadata to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'parapoker-restricted-archives',
  'parapoker-restricted-archives',
  false,
  52428800,
  array['application/json', 'application/gzip']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "operators can read restricted archive objects" on storage.objects;
create policy "operators can read restricted archive objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'parapoker-restricted-archives'
  and exists (
    select 1
    from public.operator_roles
    where operator_roles.account_id = (select auth.uid())
      and operator_roles.role in ('admin', 'support', 'importer')
  )
);
