-- First-party product analytics. Written only by the server ingest route and read only by
-- owner-only Control Center routes, both with the service role. RLS is enabled and forced
-- with no anon/authenticated policies, so browsers can never read or write these tables.

create table if not exists public.analytics_events (
  id uuid primary key,                         -- client-generated: retries are idempotent
  name text not null check (char_length(name) between 1 and 60),
  ts timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null check (source in ('public', 'app', 'auth', 'control')),
  route text not null check (char_length(route) <= 120),
  session_id uuid not null,
  user_ref text check (user_ref is null or char_length(user_ref) = 32),  -- keyed hash, never the raw id
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) <= 2048),
  env text not null default 'production' check (env in ('production', 'preview', 'development')),
  deployment_id text check (char_length(deployment_id) <= 80),
  device text check (device in ('mobile', 'tablet', 'desktop')),
  viewport text check (char_length(viewport) <= 20),
  browser text check (char_length(browser) <= 20),
  referrer_domain text check (char_length(referrer_domain) <= 120),
  utm_source text check (char_length(utm_source) <= 80),
  utm_medium text check (char_length(utm_medium) <= 80),
  utm_campaign text check (char_length(utm_campaign) <= 80),
  is_test boolean not null default false,
  dropped_props text[] not null default '{}',
  missing_props text[] not null default '{}'
);
create index if not exists analytics_events_ts_idx on public.analytics_events (ts);
create index if not exists analytics_events_name_ts_idx on public.analytics_events (name, ts);
create index if not exists analytics_events_session_idx on public.analytics_events (session_id, ts);
create index if not exists analytics_events_user_idx on public.analytics_events (user_ref, ts) where user_ref is not null;

-- Rejected / duplicate traffic counters for Tracking Health.
create table if not exists public.analytics_ingest_stats (
  day date not null,
  kind text not null check (kind in ('unknown_event', 'duplicate', 'invalid_batch', 'rate_limited')),
  detail text not null default '' check (char_length(detail) <= 60),
  count bigint not null default 0,
  primary key (day, kind, detail)
);

create table if not exists public.analytics_error_groups (
  fingerprint text primary key check (char_length(fingerprint) <= 64),
  kind text not null,
  message text not null check (char_length(message) <= 160),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  occurrences bigint not null default 0,
  last_route text,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  note text not null default '' check (char_length(note) <= 1000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- Owner configuration: dashboard widgets, funnels, custom reports, alert rules.
create table if not exists public.analytics_owner_config (
  key text primary key check (key ~ '^[a-z0-9_.:-]{1,80}$'),
  value jsonb not null check (pg_column_size(value) <= 65536),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.analytics_alert_events (
  id uuid primary key default gen_random_uuid(),
  rule_id text not null check (char_length(rule_id) <= 80),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'muted', 'resolved')),
  triggered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  value double precision,
  threshold double precision,
  message text not null check (char_length(message) <= 300),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
-- One active alert per rule (dedupe); resolved ones are history.
create unique index if not exists analytics_alert_active_idx on public.analytics_alert_events (rule_id) where status in ('open', 'acknowledged', 'muted');

-- Daily rollups survive the raw retention window (13 months raw).
create table if not exists public.analytics_daily_rollups (
  day date not null,
  name text not null,
  source text not null,
  is_test boolean not null,
  events bigint not null,
  sessions bigint not null,
  users bigint not null,
  primary key (day, name, source, is_test)
);

do $$
declare t text;
begin
  foreach t in array array['analytics_events', 'analytics_ingest_stats', 'analytics_error_groups', 'analytics_owner_config', 'analytics_alert_events', 'analytics_daily_rollups'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.analytics_bump_stat(p_kind text, p_detail text, p_count bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.analytics_ingest_stats (day, kind, detail, count)
  values ((now() at time zone 'utc')::date, p_kind, left(coalesce(p_detail, ''), 60), greatest(p_count, 0))
  on conflict (day, kind, detail) do update set count = analytics_ingest_stats.count + excluded.count;
$$;

-- Group an error occurrence; a resolved group that happens again is reopened (regression).
create or replace function public.analytics_record_error(p_fingerprint text, p_kind text, p_message text, p_route text, p_count bigint, p_at timestamptz)
returns void language sql security definer set search_path = public as $$
  insert into public.analytics_error_groups (fingerprint, kind, message, first_seen, last_seen, occurrences, last_route)
  values (left(p_fingerprint, 64), left(p_kind, 30), left(p_message, 160), p_at, p_at, greatest(p_count, 1), left(p_route, 120))
  on conflict (fingerprint) do update set
    last_seen = greatest(analytics_error_groups.last_seen, excluded.last_seen),
    occurrences = analytics_error_groups.occurrences + excluded.occurrences,
    last_route = excluded.last_route,
    status = case when analytics_error_groups.status = 'resolved' then 'open' else analytics_error_groups.status end,
    updated_at = now();
$$;

-- Roll up complete days older than 2 days, then delete raw events older than 13 months.
create or replace function public.analytics_rollup_and_prune()
returns jsonb language plpgsql security definer set search_path = public as $$
declare rolled bigint; pruned bigint;
begin
  insert into public.analytics_daily_rollups (day, name, source, is_test, events, sessions, users)
  select (ts at time zone 'utc')::date, name, source, is_test, count(*), count(distinct session_id), count(distinct user_ref)
  from public.analytics_events
  where ts < date_trunc('day', now() at time zone 'utc') - interval '2 days'
    and ts >= coalesce((select max(day) + 1 from public.analytics_daily_rollups), '2000-01-01'::date)
  group by 1, 2, 3, 4
  on conflict (day, name, source, is_test) do nothing;
  get diagnostics rolled = row_count;
  delete from public.analytics_events where ts < now() - interval '13 months';
  get diagnostics pruned = row_count;
  return jsonb_build_object('rolled', rolled, 'pruned', pruned);
end $$;

-- Historical activity from existing student tables (no event tracking needed): rows created
-- per local day per feature and the distinct accounts writing. Seeded syllabus chapters are
-- excluded because they are created in bulk at signup, not by the student.
create or replace function public.analytics_business_activity(p_from timestamptz, p_to timestamptz, p_tz text)
returns table (day date, feature text, created bigint, users bigint)
language sql stable security definer set search_path = public as $$
  with rows as (
    select 'tests'::text f, user_id, created_at from public.tests
    union all select 'test_subject_scores', user_id, created_at from public.test_subject_scores
    union all select 'mistakes', user_id, created_at from public.mistakes
    union all select 'practice_sessions', user_id, created_at from public.practice_sessions
    union all select 'pyq_records', user_id, created_at from public.pyq_records
    union all select 'study_sessions', user_id, created_at from public.study_sessions
    union all select 'study_cards', user_id, created_at from public.study_cards
    union all select 'daily_tasks', user_id, created_at from public.daily_tasks
    union all select 'weekly_goals', user_id, created_at from public.weekly_goals
    union all select 'backlog_items', user_id, created_at from public.backlog_items
    union all select 'chapter_revisions', user_id, created_at from public.chapter_revisions
    union all select 'chapter_stages', user_id, created_at from public.chapter_stages
    union all select 'test_error_logs', user_id, created_at from public.test_error_logs
    union all select 'test_time_entries', user_id, created_at from public.test_time_entries
    union all select 'ai_conversations', user_id, created_at from public.ai_conversations
  )
  select (created_at at time zone p_tz)::date, f, count(*), count(distinct user_id)
  from rows where created_at >= p_from and created_at < p_to
  group by 1, 2;
$$;

-- Distinct accounts that created at least one row of each kind in [p_from, p_to).
create or replace function public.analytics_feature_accounts(p_from timestamptz, p_to timestamptz)
returns table (feature text, users bigint)
language sql stable security definer set search_path = public as $$
  with rows as (
    select 'tests'::text f, user_id, created_at from public.tests
    union all select 'mistakes', user_id, created_at from public.mistakes
    union all select 'practice_sessions', user_id, created_at from public.practice_sessions
    union all select 'pyq_records', user_id, created_at from public.pyq_records
    union all select 'study_sessions', user_id, created_at from public.study_sessions
    union all select 'study_cards', user_id, created_at from public.study_cards
    union all select 'daily_tasks', user_id, created_at from public.daily_tasks
    union all select 'weekly_goals', user_id, created_at from public.weekly_goals
    union all select 'backlog_items', user_id, created_at from public.backlog_items
    union all select 'chapter_revisions', user_id, created_at from public.chapter_revisions
    union all select 'chapter_stages', user_id, created_at from public.chapter_stages
    union all select 'ai_conversations', user_id, created_at from public.ai_conversations
  )
  select f, count(distinct user_id) from rows where created_at >= p_from and created_at < p_to group by 1;
$$;

-- Distinct (account, local day) pairs with any student write (created or last updated) — the
-- historical basis for active users and retention. updated_at keeps only the latest edit per
-- row, so this undercounts older activity (reported as Partial).
create or replace function public.analytics_business_active_days(p_from timestamptz, p_to timestamptz, p_tz text)
returns table (user_id uuid, day date)
language sql stable security definer set search_path = public as $$
  select distinct user_id, (at at time zone p_tz)::date from (
    select user_id, created_at at from public.tests union all select user_id, updated_at from public.tests
    union all select user_id, created_at from public.mistakes union all select user_id, updated_at from public.mistakes
    union all select user_id, created_at from public.practice_sessions
    union all select user_id, created_at from public.study_sessions
    union all select user_id, created_at from public.daily_tasks union all select user_id, updated_at from public.daily_tasks
    union all select user_id, updated_at from public.chapters where updated_at > created_at + interval '1 minute'
    union all select user_id, updated_at from public.chapter_stages
    union all select user_id, created_at from public.pyq_records
    union all select user_id, created_at from public.study_cards union all select user_id, updated_at from public.study_cards
    union all select user_id, created_at from public.backlog_items
    union all select user_id, created_at from public.weekly_goals
  ) a where at >= p_from and at < p_to and user_id is not null;
$$;

-- Most recent student write per feature (updated_at), plus signup facts from auth.users.
create or replace function public.analytics_data_operations()
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'last_write', (select jsonb_object_agg(f, at) from (
      select 'tests' f, max(updated_at) at from public.tests
      union all select 'mistakes', max(updated_at) from public.mistakes
      union all select 'chapters', max(updated_at) from public.chapters
      union all select 'daily_tasks', max(updated_at) from public.daily_tasks
      union all select 'study_sessions', max(updated_at) from public.study_sessions
      union all select 'practice_sessions', max(updated_at) from public.practice_sessions
      union all select 'study_cards', max(updated_at) from public.study_cards
      union all select 'app_settings', max(updated_at) from public.app_settings
    ) s where at is not null),
    'row_counts', (select jsonb_object_agg(f, n) from (
      select 'tests' f, count(*) n from public.tests union all select 'mistakes', count(*) from public.mistakes
      union all select 'chapters', count(*) from public.chapters union all select 'daily_tasks', count(*) from public.daily_tasks
      union all select 'study_sessions', count(*) from public.study_sessions union all select 'practice_sessions', count(*) from public.practice_sessions
      union all select 'study_cards', count(*) from public.study_cards
    ) c)
  );
$$;

-- Signups (auth.users) between two instants, for funnels/cohorts. Ids only; no emails.
create or replace function public.analytics_signups(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, created_at timestamptz, confirmed_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select id, created_at, email_confirmed_at, last_sign_in_at from auth.users
  where created_at >= p_from and created_at < p_to;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'analytics_bump_stat(text, text, bigint)',
    'analytics_record_error(text, text, text, text, bigint, timestamptz)',
    'analytics_rollup_and_prune()',
    'analytics_business_activity(timestamptz, timestamptz, text)',
    'analytics_business_active_days(timestamptz, timestamptz, text)',
    'analytics_data_operations()',
    'analytics_feature_accounts(timestamptz, timestamptz)',
    'analytics_signups(timestamptz, timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
