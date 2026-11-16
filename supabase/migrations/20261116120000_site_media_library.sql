-- Live Site Editor assets library: owner-written name and alt text for uploaded media.
-- Additive only: two nullable-safe columns with defaults and length checks. RLS stays enabled
-- and forced on public.site_media; there are still no grants to anon/authenticated, so only the
-- Control Center API (service role, after the owner aal2 check) can read or change these rows.

alter table public.site_media add column if not exists name text not null default '';
alter table public.site_media add column if not exists alt text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'site_media_name_shape' and conrelid = 'public.site_media'::regclass) then
    alter table public.site_media add constraint site_media_name_shape check (char_length(name) <= 80 and name !~ '[<>[:cntrl:]]');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'site_media_alt_shape' and conrelid = 'public.site_media'::regclass) then
    alter table public.site_media add constraint site_media_alt_shape check (char_length(alt) <= 200 and alt !~ '[<>[:cntrl:]]');
  end if;
end $$;
