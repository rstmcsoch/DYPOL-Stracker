-- Stracker Control Center: trusted role assignments, an append-only audit trail,
-- a durable rate-limit table, and service-role-only aggregate functions.
--
-- Security model:
--   * None of the tables or functions below is granted to anon or authenticated.
--     The browser cannot read, write, or call them directly, whatever the JWT claims.
--   * Only the Vercel /api/control/* functions use the service role, and each one
--     verifies the caller's JWT, the active owner row, and the aal2 assurance level first.
--   * Existing notebook tables, RLS policies, and rows are not changed.
--
-- Reversal: supabase/rollbacks/20261009210000_control_center_admin.down.sql

-- ---------------------------------------------------------------------------
-- Role assignments. A user has at most one role. Revocation is a timestamp, so
-- history is kept. The provisioning script and the server are the only writers.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','administrator','support','analyst')),
  granted_by uuid,
  granted_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  reason text not null default '' check (char_length(reason) <= 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.admin_roles enable row level security;
alter table public.admin_roles force row level security;
revoke all on table public.admin_roles from public, anon, authenticated;
grant select, insert, update on table public.admin_roles to service_role;

drop trigger if exists set_updated_at on public.admin_roles;
create trigger set_updated_at before update on public.admin_roles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Append-only audit trail. There is no foreign key to auth.users on purpose:
-- an audit entry must survive the deletion of the account it describes.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default timezone('utc', now()),
  request_id text not null default '' check (char_length(request_id) <= 80),
  actor_id uuid,
  actor_role text check (actor_role is null or char_length(actor_role) <= 30),
  action text not null check (action ~ '^[a-z][a-z0-9_.]{0,79}$'),
  target_type text not null default '' check (char_length(target_type) <= 40),
  target_id text not null default '' check (char_length(target_id) <= 120),
  outcome text not null check (outcome in ('success','denied','failed')),
  severity text not null default 'info' check (severity in ('info','notice','warning','critical')),
  error_code text not null default '' check (char_length(error_code) <= 60),
  reason text not null default '' check (char_length(reason) <= 500),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 4096)
);

create index if not exists admin_audit_occurred_idx on public.admin_audit_events (occurred_at desc);
create index if not exists admin_audit_actor_idx on public.admin_audit_events (actor_id, occurred_at desc);
create index if not exists admin_audit_target_idx on public.admin_audit_events (target_id, occurred_at desc);
create index if not exists admin_audit_outcome_idx on public.admin_audit_events (outcome, occurred_at desc);

create or replace function public.admin_audit_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_events is append-only' using errcode = '42501';
end;
$$;

revoke all on function public.admin_audit_block_mutation() from public, anon, authenticated;

drop trigger if exists admin_audit_no_update_delete on public.admin_audit_events;
create trigger admin_audit_no_update_delete before update or delete on public.admin_audit_events
for each row execute function public.admin_audit_block_mutation();

drop trigger if exists admin_audit_no_truncate on public.admin_audit_events;
create trigger admin_audit_no_truncate before truncate on public.admin_audit_events
for each statement execute function public.admin_audit_block_mutation();

alter table public.admin_audit_events enable row level security;
alter table public.admin_audit_events force row level security;
revoke all on table public.admin_audit_events from public, anon, authenticated;
grant select, insert on table public.admin_audit_events to service_role;
grant usage on sequence public.admin_audit_events_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Durable rate-limit slots for the console (per account, per IP-hash, per bucket).
-- ---------------------------------------------------------------------------
create table if not exists public.admin_rate_events (
  id bigint generated always as identity primary key,
  bucket_key text not null check (char_length(bucket_key) between 1 and 160),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_rate_events_key_idx on public.admin_rate_events (bucket_key, created_at desc);

alter table public.admin_rate_events enable row level security;
alter table public.admin_rate_events force row level security;
revoke all on table public.admin_rate_events from public, anon, authenticated;
grant select, insert, delete on table public.admin_rate_events to service_role;
grant usage on sequence public.admin_rate_events_id_seq to service_role;

create or replace function public.admin_take_rate_slot(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  taken integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 160
     or p_limit is null or p_limit not between 1 and 100000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('stracker-admin-rate'), pg_catalog.hashtext(p_key));

  delete from public.admin_rate_events
  where bucket_key = p_key
    and created_at < timezone('utc', now()) - make_interval(secs => p_window_seconds);

  select count(*) into taken
  from public.admin_rate_events
  where bucket_key = p_key
    and created_at > timezone('utc', now()) - make_interval(secs => p_window_seconds);

  if taken >= p_limit then
    return false;
  end if;

  insert into public.admin_rate_events (bucket_key) values (p_key);
  return true;
end;
$$;

revoke all on function public.admin_take_rate_slot(text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_take_rate_slot(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Aggregate functions for the console. They read auth.users and public tables
-- and return only counts or the minimum columns the directory needs.
-- ---------------------------------------------------------------------------

-- Overview metrics for a half-open window [p_since, p_until).
--   total_accounts        every auth user
--   registrations         accounts created in the window
--   verified_accounts     accounts with a confirmed email (current state, all time)
--   pending_confirmation  accounts whose email is still unconfirmed (current state)
--   pending_over_3_days   of those, created more than 3 days ago
--   active_accounts       accounts whose LAST sign-in fell inside the window
--   suspended_accounts    accounts banned until a time in the future
--   tests_logged          test rows created in the window
--   accounts_with_tests   accounts with at least one test row (all time)
create or replace function public.admin_overview_metrics(p_since timestamptz, p_until timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total_accounts', (select count(*) from auth.users),
    'registrations', (select count(*) from auth.users u where u.created_at >= p_since and u.created_at < p_until),
    'verified_accounts', (select count(*) from auth.users u where u.email_confirmed_at is not null),
    'pending_confirmation', (select count(*) from auth.users u where u.email_confirmed_at is null),
    'pending_over_3_days', (select count(*) from auth.users u where u.email_confirmed_at is null and u.created_at < timezone('utc', now()) - interval '3 days'),
    'active_accounts', (select count(*) from auth.users u where u.last_sign_in_at >= p_since and u.last_sign_in_at < p_until),
    'suspended_accounts', (select count(*) from auth.users u where u.banned_until is not null and u.banned_until > timezone('utc', now())),
    'tests_logged', (select count(*) from public.tests t where t.created_at >= p_since and t.created_at < p_until),
    'accounts_with_tests', (select count(distinct t.user_id) from public.tests t)
  );
$$;

-- Daily registration series for the window, zero-filled, UTC days.
create or replace function public.admin_registration_series(p_since timestamptz, p_until timestamptz)
returns table (day date, registrations bigint, verified bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select generate_series(
      date_trunc('day', p_since at time zone 'UTC'),
      date_trunc('day', (p_until - interval '1 second') at time zone 'UTC'),
      interval '1 day'
    )::date as day
  ),
  counts as (
    select (u.created_at at time zone 'UTC')::date as day,
           count(*) as registrations,
           count(*) filter (where u.email_confirmed_at is not null) as verified
    from auth.users u
    where u.created_at >= p_since and u.created_at < p_until
    group by 1
  )
  select d.day, coalesce(c.registrations, 0), coalesce(c.verified, 0)
  from days d
  left join counts c on c.day = d.day
  order by d.day;
$$;

-- Directory search. Search text is compared case-insensitively as plain text
-- (position/lower), never as a LIKE pattern, so % and _ are literal characters.
-- Sort and status values are whitelisted in CASE expressions, never concatenated.
create or replace function public.admin_list_users(
  p_search text,
  p_status text,
  p_sort text,
  p_limit integer,
  p_offset integer
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  tests_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select u.id, u.email::text as email, coalesce(p.display_name, '')::text as display_name,
           u.created_at, u.last_sign_in_at, u.email_confirmed_at, u.banned_until
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where (
      coalesce(p_search, '') = ''
      or position(lower(p_search) in lower(coalesce(u.email, ''))) > 0
      or position(lower(p_search) in lower(coalesce(p.display_name, ''))) > 0
      or u.id::text = lower(p_search)
    )
    and (
      p_status is null or p_status = 'all'
      or (p_status = 'verified' and u.email_confirmed_at is not null)
      or (p_status = 'unverified' and u.email_confirmed_at is null)
      or (p_status = 'suspended' and u.banned_until is not null and u.banned_until > timezone('utc', now()))
    )
  ),
  ordered as (
    select f.*
    from filtered f
    order by
      case when p_sort = 'created_asc' then f.created_at end asc,
      case when p_sort = 'last_sign_in' then f.last_sign_in_at end desc nulls last,
      case when p_sort is null or p_sort not in ('created_asc', 'last_sign_in') then f.created_at end desc,
      f.id
    limit greatest(least(coalesce(p_limit, 25), 100), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select o.id, o.email, o.display_name, o.created_at, o.last_sign_in_at, o.email_confirmed_at, o.banned_until,
         (select count(*) from public.tests t where t.user_id = o.id) as tests_count,
         (select count(*) from filtered) as total_count
  from ordered o;
$$;

revoke all on function public.admin_overview_metrics(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_registration_series(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_list_users(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_overview_metrics(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_registration_series(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_list_users(text, text, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
