-- Owner-managed media for the public homepage player (promotional video + poster).
--
-- Scope and safety:
--   * The `homepage-media` bucket is PUBLIC READ so anonymous visitors can load the
--     published video without signed URLs or a backend hop.
--   * Writes (upload, replace, delete) require an active `owner` row in
--     public.control_roles — the same server-side role the Control Center enforces.
--     Hiding the console UI would grant nothing.
--   * The bucket itself enforces MIME types and a per-object size cap, independent
--     of any client behaviour.
--   * Nothing here touches study data, accounts, drafts or the published site copy:
--     the homepage only ever reads a URL that the owner published through the
--     existing site-content pipeline.

-- The control-role table is provisioned per deployment through the owner
-- provisioning procedure; declaring it idempotently keeps fresh projects able to
-- apply this migration. As documented, anon/authenticated hold no grants on it.
create table if not exists public.control_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.control_roles enable row level security;
revoke all on table public.control_roles from public, anon, authenticated;
grant select, insert, update, delete on table public.control_roles to service_role;

-- Storage policies cannot read control_roles directly (it has no role grants), so a
-- SECURITY DEFINER helper exposes only the boolean answer, never the rows.
create or replace function public.is_control_owner()
returns boolean
language sql stable security definer set search_path = 'public'
as $$
  select exists (
    select 1 from public.control_roles
    where user_id = auth.uid() and role = 'owner' and revoked_at is null
  );
$$;
revoke execute on function public.is_control_owner() from public, anon;
grant execute on function public.is_control_owner() to authenticated;

-- 64 MB per object leaves headroom above the recommended 2-4 MB web cut while the
-- bucket still refuses anything that is not an MP4 or a still image.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('homepage-media', 'homepage-media', true, 67108864,
        array['video/mp4', 'image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update set
  public = true,
  file_size_limit = 67108864,
  allowed_mime_types = array['video/mp4', 'image/jpeg', 'image/webp', 'image/png'];

drop policy if exists "homepage media is public read" on storage.objects;
create policy "homepage media is public read" on storage.objects
for select to anon, authenticated
using (bucket_id = 'homepage-media');

drop policy if exists "owner uploads homepage media" on storage.objects;
create policy "owner uploads homepage media" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'homepage-media'
  and public.is_control_owner()
  and (storage.foldername(name))[1] in ('videos', 'posters')
);

drop policy if exists "owner replaces homepage media" on storage.objects;
create policy "owner replaces homepage media" on storage.objects
for update to authenticated
using (bucket_id = 'homepage-media' and public.is_control_owner())
with check (
  bucket_id = 'homepage-media'
  and public.is_control_owner()
  and (storage.foldername(name))[1] in ('videos', 'posters')
);

drop policy if exists "owner deletes homepage media" on storage.objects;
create policy "owner deletes homepage media" on storage.objects
for delete to authenticated
using (bucket_id = 'homepage-media' and public.is_control_owner());

notify pgrst, 'reload schema';
