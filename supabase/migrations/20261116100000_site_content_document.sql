-- Live Site Editor: the page document (structure, editor blocks, styles, design tokens) is
-- stored next to the existing copy overrides and is drafted, published, versioned and
-- restored together with it through one commit function.
--
-- Additive only: nullable columns (null = the page as shipped), new constraints only on the
-- new columns, and a new commit function. The existing site_content_commit, tables, rows,
-- grants and RLS policies are left exactly as they were. The published row stays the one
-- public read (its document is the public page structure, never draft data).

alter table public.site_content_draft add column if not exists document jsonb;
alter table public.site_content_published add column if not exists document jsonb;
alter table public.site_content_versions add column if not exists document jsonb;

do $$
declare
  t text;
begin
  foreach t in array array['site_content_draft', 'site_content_published', 'site_content_versions'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_document_shape') then
      execute format(
        'alter table public.%I add constraint %I check (document is null or (jsonb_typeof(document) = ''object'' and octet_length(document::text) <= 300000))',
        t, t || '_document_shape'
      );
    end if;
  end loop;
end
$$;

create or replace function public.site_content_commit_document(
  p_actor uuid,
  p_action text,
  p_content jsonb,
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
  current_content jsonb;
  current_document jsonb;
  next_version integer;
begin
  if p_action not in ('publish', 'restore') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'invalid_content' using errcode = '22023';
  end if;
  if p_document is not null and jsonb_typeof(p_document) <> 'object' then
    raise exception 'invalid_document' using errcode = '22023';
  end if;

  -- Same lock as site_content_commit, so the two can never interleave.
  perform pg_advisory_xact_lock(hashtext('public.site_content_commit'));

  select content, document into current_content, current_document from public.site_content_published where id = 1;
  if found and current_content = p_content and current_document is not distinct from p_document then
    raise exception 'no_changes' using errcode = 'P0001';
  end if;

  select coalesce(max(version), 0) + 1 into next_version from public.site_content_versions;

  insert into public.site_content_versions (version, content, document, schema_version, action, restored_from, note, created_by)
  values (next_version, p_content, p_document, p_schema_version, p_action, p_restored_from, nullif(left(coalesce(p_note, ''), 280), ''), p_actor);

  insert into public.site_content_published (id, content, document, schema_version, version, published_at, published_by)
  values (1, p_content, p_document, p_schema_version, next_version, now(), p_actor)
  on conflict (id) do update set
    content = excluded.content,
    document = excluded.document,
    schema_version = excluded.schema_version,
    version = excluded.version,
    published_at = excluded.published_at,
    published_by = excluded.published_by;

  delete from public.site_content_draft where id = 1;

  return next_version;
end;
$$;

revoke all on function public.site_content_commit_document(uuid, text, jsonb, jsonb, integer, integer, text) from public, anon, authenticated;
grant execute on function public.site_content_commit_document(uuid, text, jsonb, jsonb, integer, integer, text) to service_role;
