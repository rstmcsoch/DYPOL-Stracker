-- Security Audit Hardening Migration (2026-10-14)
-- 1. Ensures base Control Center tables exist idempotently and enforce FORCE ROW LEVEL SECURITY.
-- 2. Enforces FORCE ROW LEVEL SECURITY on site_content_draft, site_content_published, and site_content_versions.
-- 3. Pins search_path = pg_catalog, public on SECURITY DEFINER functions.

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'site_content_draft',
    'site_content_published',
    'site_content_versions',
    'site_media',
    'exam_catalog',
    'control_roles',
    'control_audit_events',
    'control_rate_events',
    'analytics_events',
    'analytics_ingest_stats',
    'analytics_error_groups',
    'analytics_owner_config',
    'analytics_alert_events',
    'analytics_daily_rollups'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('alter table public.%I force row level security', tbl);
    end if;
  end loop;
end $$;

do $$
begin
  if to_regprocedure('public.site_content_commit(jsonb, text, uuid)') is not null then
    execute 'alter function public.site_content_commit(jsonb, text, uuid) set search_path = pg_catalog, public';
  end if;
  if to_regprocedure('public.analytics_bump_stat(text, text, bigint)') is not null then
    execute 'alter function public.analytics_bump_stat(text, text, bigint) set search_path = pg_catalog, public';
  end if;
  if to_regprocedure('public.analytics_record_error(text, text, text, text, bigint, timestamptz)') is not null then
    execute 'alter function public.analytics_record_error(text, text, text, text, bigint, timestamptz) set search_path = pg_catalog, public';
  end if;
  if to_regprocedure('public.analytics_rollup_and_prune()') is not null then
    execute 'alter function public.analytics_rollup_and_prune() set search_path = pg_catalog, public';
  end if;
end $$;

notify pgrst, 'reload schema';
