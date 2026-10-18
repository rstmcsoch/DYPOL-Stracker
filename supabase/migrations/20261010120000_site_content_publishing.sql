-- Owner-managed website and user-panel copy: draft, published and version history.
--
-- Scope and safety:
--   * Only editable copy is stored here: sparse { field_key: text } overrides on top of
--     the defaults in src/lib/site-content/registry.ts. No code, routes, access rules,
--     roles, study data, accounts or audit rows are read or written by this model.
--   * `site_content_draft` and `site_content_versions` are service-role only.
--   * `site_content_published` is the one public read: visitors need the published copy,
--     and it never contains draft data. Its row is written only by site_content_commit.
--   * Publish and restore run in one transaction through site_content_commit, under an
--     advisory lock, so the published row, the version row and the draft cleanup can never
--     be observed half-done, and version numbers cannot collide.

create table if not exists public.site_content_draft (
  id smallint primary key default 1,
  content jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint site_content_draft_singleton check (id = 1),
  constraint site_content_draft_object check (jsonb_typeof(content) = 'object'),
  constraint site_content_draft_size check (octet_length(content::text) <= 200000)
);

create table if not exists public.site_content_published (
  id smallint primary key default 1,
  content jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  version integer not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null,
  constraint site_content_published_singleton check (id = 1),
  constraint site_content_published_object check (jsonb_typeof(content) = 'object'),
  constraint site_content_published_size check (octet_length(content::text) <= 200000),
  constraint site_content_published_version check (version >= 1)
);

create table if not exists public.site_content_versions (
  version integer primary key,
  content jsonb not null,
  schema_version integer not null default 1,
  action text not null,
  restored_from integer,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint site_content_versions_object check (jsonb_typeof(content) = 'object'),
  constraint site_content_versions_size check (octet_length(content::text) <= 200000),
  constraint site_content_versions_action check (action in ('publish', 'restore')),
  constraint site_content_versions_note check (note is null or char_length(note) <= 280),
  constraint site_content_versions_version check (version >= 1)
);

create index if not exists site_content_versions_created_by_idx on public.site_content_versions (created_by);
create index if not exists site_content_versions_restored_from_idx on public.site_content_versions (restored_from);
create index if not exists site_content_draft_updated_by_idx on public.site_content_draft (updated_by);
create index if not exists site_content_published_published_by_idx on public.site_content_published (published_by);

alter table public.site_content_draft enable row level security;
alter table public.site_content_published enable row level security;
alter table public.site_content_versions enable row level security;

revoke all on table public.site_content_draft from public, anon, authenticated;
revoke all on table public.site_content_versions from public, anon, authenticated;
revoke all on table public.site_content_published from public, anon, authenticated;
grant select, insert, update, delete on table public.site_content_draft to service_role;
grant select, insert, update, delete on table public.site_content_versions to service_role;
grant select, insert, update, delete on table public.site_content_published to service_role;

-- The published copy is public by design. Only the singleton row is visible; no policy
-- exposes drafts or history.
grant select on table public.site_content_published to anon, authenticated;
drop policy if exists site_content_published_public_read on public.site_content_published;
create policy site_content_published_public_read on public.site_content_published
  for select to anon, authenticated
  using (id = 1);

create or replace function public.site_content_commit(
  p_actor uuid,
  p_action text,
  p_content jsonb,
  p_schema_version integer,
  p_restored_from integer,
  p_note text
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  current_content jsonb;
  next_version integer;
begin
  if p_action not in ('publish', 'restore') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'invalid_content' using errcode = '22023';
  end if;

  -- Serialise every publish and restore so version numbers are dense and unique.
  perform pg_advisory_xact_lock(hashtext('public.site_content_commit'));

  select content into current_content from public.site_content_published where id = 1;
  if found and current_content = p_content then
    raise exception 'no_changes' using errcode = 'P0001';
  end if;

  select coalesce(max(version), 0) + 1 into next_version from public.site_content_versions;

  insert into public.site_content_versions (version, content, schema_version, action, restored_from, note, created_by)
  values (next_version, p_content, p_schema_version, p_action, p_restored_from, nullif(left(coalesce(p_note, ''), 280), ''), p_actor);

  insert into public.site_content_published (id, content, schema_version, version, published_at, published_by)
  values (1, p_content, p_schema_version, next_version, now(), p_actor)
  on conflict (id) do update set
    content = excluded.content,
    schema_version = excluded.schema_version,
    version = excluded.version,
    published_at = excluded.published_at,
    published_by = excluded.published_by;

  -- The draft now equals the published copy; keeping a stale draft would invite confusion.
  delete from public.site_content_draft where id = 1;

  return next_version;
end;
$$;

revoke all on function public.site_content_commit(uuid, text, jsonb, integer, integer, text) from public, anon, authenticated;
grant execute on function public.site_content_commit(uuid, text, jsonb, integer, integer, text) to service_role;
