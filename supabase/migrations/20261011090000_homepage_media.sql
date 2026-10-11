-- Owner-managed media for the public homepage (promo video + poster image).
--
-- Safety model:
--   * Bucket `homepage-media` is public-read via the public object URL only; there is no
--     SELECT policy on storage.objects, so anon/authenticated clients cannot list it.
--   * There are NO insert/update/delete policies for anon or authenticated. Uploads use
--     single-use signed upload URLs minted by the Control Center API (service role) after
--     it has verified an active owner with aal2 — the same gate as publishing.
--   * The bucket enforces MIME types and a size cap regardless of client behaviour.
--   * `public.site_media` records each minted upload; RLS enabled and FORCED, no grants to
--     anon/authenticated, so only the service role can read or write it.
--   * Nothing here reads or changes existing tables or their data.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('homepage-media', 'homepage-media', true, 52428800,
        array['video/mp4', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.site_media (
  path text primary key check (path ~ '^site/(image|video)/[0-9a-f-]{36}\.(mp4|jpg|png|webp)$'),
  kind text not null check (kind in ('image', 'video')),
  mime text not null check (mime in ('video/mp4', 'image/jpeg', 'image/png', 'image/webp')),
  bytes bigint not null check (bytes > 0 and bytes <= 52428800),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create index if not exists site_media_created_by_idx on public.site_media (created_by);

alter table public.site_media enable row level security;
alter table public.site_media force row level security;
revoke all on table public.site_media from public, anon, authenticated;
grant select, insert, update, delete on table public.site_media to service_role;
