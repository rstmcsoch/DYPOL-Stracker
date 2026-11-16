-- Student Dashboard Editor: draft, published layout and version history for the shared
-- presentation of the signed-in student workspace.
--
-- Scope and safety:
--   * Presentation only: a validated layout document (component visibility, order, static
--     labels, styles, responsive overrides, navigation order, design tokens). It never holds
--     student records, and nothing here reads or writes any student table.
--   * Kept apart from the public website (site_content_*): separate tables, separate commit
--     function, separate lock.
--   * `student_layout_draft` and `student_layout_versions` are service-role only (Control
--     Center API after role + permission + aal2 checks; publish/restore also need fresh MFA).
--   * `student_layout_published` is readable by signed-in users only (their workspace needs
--     it); anonymous visitors cannot read it. It is written only by student_layout_commit.
--   * Additive only: new tables, indexes, policies and one function.

create table if not exists public.student_layout_draft (
  id smallint primary key default 1,
  document jsonb not null,
  schema_version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint student_layout_draft_singleton check (id = 1),
  constraint student_layout_draft_shape check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 200000)
);

create table if not exists public.student_layout_published (
  id smallint primary key default 1,
  document jsonb not null,
  schema_version integer not null default 1,
  version integer not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null,
  constraint student_layout_published_singleton check (id = 1),
  constraint student_layout_published_shape check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 200000),
  constraint student_layout_published_version check (version >= 1)
);

create table if not exists public.student_layout_versions (
  version integer primary key,
  document jsonb not null,
  schema_version integer not null default 1,
  action text not null,
  restored_from integer,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint student_layout_versions_shape check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 200000),
  constraint student_layout_versions_action check (action in ('publish', 'restore')),
  constraint student_layout_versions_note check (note is null or char_length(note) <= 280),
  constraint student_layout_versions_version check (version >= 1)
);

create index if not exists student_layout_draft_updated_by_idx on public.student_layout_draft (updated_by);
create index if not exists student_layout_published_published_by_idx on public.student_layout_published (published_by);
create index if not exists student_layout_versions_created_by_idx on public.student_layout_versions (created_by);
create index if not exists student_layout_versions_restored_from_idx on public.student_layout_versions (restored_from);

alter table public.student_layout_draft enable row level security;
alter table public.student_layout_published enable row level security;
alter table public.student_layout_versions enable row level security;
alter table public.student_layout_draft force row level security;
alter table public.student_layout_published force row level security;
alter table public.student_layout_versions force row level security;

revoke all on table public.student_layout_draft from public, anon, authenticated;
revoke all on table public.student_layout_published from public, anon, authenticated;
revoke all on table public.student_layout_versions from public, anon, authenticated;
grant select, insert, update, delete on table public.student_layout_draft to service_role;
grant select, insert, update, delete on table public.student_layout_published to service_role;
grant select, insert, update, delete on table public.student_layout_versions to service_role;

-- Signed-in students read the one published row (presentation only). No policy exposes
-- drafts or history, and there is no client write path.
grant select on table public.student_layout_published to authenticated;
drop policy if exists student_layout_published_read on public.student_layout_published;
create policy student_layout_published_read on public.student_layout_published
  for select to authenticated
  using (id = 1);

create or replace function public.student_layout_commit(
  p_actor uuid,
  p_action text,
  p_document jsonb,
  p_schema_version integer,
  p_restored_from integer,
  p_note text
)
returns integer
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_document jsonb;
  next_version integer;
begin
  if p_action not in ('publish', 'restore') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if p_document is null or jsonb_typeof(p_document) <> 'object' then
    raise exception 'invalid_document' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.student_layout_commit'));

  select document into current_document from public.student_layout_published where id = 1;
  if found and current_document = p_document then
    raise exception 'no_changes' using errcode = 'P0001';
  end if;

  select coalesce(max(version), 0) + 1 into next_version from public.student_layout_versions;

  insert into public.student_layout_versions (version, document, schema_version, action, restored_from, note, created_by)
  values (next_version, p_document, p_schema_version, p_action, p_restored_from, nullif(left(coalesce(p_note, ''), 280), ''), p_actor);

  insert into public.student_layout_published (id, document, schema_version, version, published_at, published_by)
  values (1, p_document, p_schema_version, next_version, now(), p_actor)
  on conflict (id) do update set
    document = excluded.document,
    schema_version = excluded.schema_version,
    version = excluded.version,
    published_at = excluded.published_at,
    published_by = excluded.published_by;

  -- A publish consumes the draft; a restore leaves the current draft intact.
  if p_action = 'publish' then
    delete from public.student_layout_draft where id = 1;
  end if;

  return next_version;
end;
$$;

revoke all on function public.student_layout_commit(uuid, text, jsonb, integer, integer, text) from public, anon, authenticated;
grant execute on function public.student_layout_commit(uuid, text, jsonb, integer, integer, text) to service_role;
