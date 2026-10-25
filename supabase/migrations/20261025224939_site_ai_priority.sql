-- Stracker AI (Default): owner-controlled fallback order for site models (1 = tried first).
-- Additive only. Backfills the current order (preferred first, then most recently updated).
alter table public.site_ai_providers add column if not exists priority integer not null default 0;
with ordered as (
  select id, row_number() over (order by is_default desc, updated_at desc) as rn
  from public.site_ai_providers
)
update public.site_ai_providers p set priority = o.rn from ordered o where p.id = o.id and p.priority = 0;
create index if not exists site_ai_providers_priority_idx on public.site_ai_providers(priority);
