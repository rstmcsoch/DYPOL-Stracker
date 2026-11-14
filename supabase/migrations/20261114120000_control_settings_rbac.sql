-- Control Center Settings: roles & permissions, site status, access switches, step-up saves.
-- Additive and forward-only. Existing rows (the owner) are untouched.

-- 1. Roles: add "manager"; allow console-made grants. Widening CHECKs only.
alter table public.control_roles drop constraint if exists control_roles_role_check;
alter table public.control_roles add constraint control_roles_role_check
  check (role = any (array['owner','administrator','manager','support','analyst']));
alter table public.control_roles drop constraint if exists control_roles_grant_source_check;
alter table public.control_roles add constraint control_roles_grant_source_check
  check (grant_source = any (array['bootstrap','owner','console']));

-- 2. Role permission matrix (owner is implicit: always every permission, never stored).
create table if not exists public.control_role_permissions (
  role text not null check (role = any (array['administrator','manager','support','analyst'])),
  permission text not null check (permission ~ '^[a-z]+\.[a-z]+$' and char_length(permission) <= 40),
  allowed boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (role, permission)
);
alter table public.control_role_permissions enable row level security;
alter table public.control_role_permissions force row level security;
revoke all on public.control_role_permissions from anon, authenticated;
create index if not exists control_role_permissions_updated_by_idx on public.control_role_permissions(updated_by);

-- 3. Per-person overrides (allow / deny) on top of the role.
create table if not exists public.control_member_permissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null check (permission ~ '^[a-z]+\.[a-z]+$' and char_length(permission) <= 40),
  allowed boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, permission)
);
alter table public.control_member_permissions enable row level security;
alter table public.control_member_permissions force row level security;
revoke all on public.control_member_permissions from anon, authenticated;
create index if not exists control_member_permissions_updated_by_idx on public.control_member_permissions(updated_by);

-- Default matrix (owner can change every cell in Settings → Permissions).
insert into public.control_role_permissions (role, permission, allowed)
select r.role, p.permission, (r.role, p.permission) in (
  -- administrator: everything except role management and Stracker AI keys
  ('administrator','overview.view'),('administrator','messages.view'),('administrator','messages.manage'),
  ('administrator','users.view'),('administrator','users.manage'),('administrator','analytics.view'),('administrator','analytics.manage'),
  ('administrator','audit.view'),('administrator','audit.export'),('administrator','health.view'),('administrator','security.view'),
  ('administrator','appearance.edit'),('administrator','appearance.publish'),('administrator','exams.manage'),
  ('administrator','settings.site'),('administrator','settings.access'),
  -- manager: day-to-day content and people, no exports, publishing or settings
  ('manager','overview.view'),('manager','messages.view'),('manager','messages.manage'),('manager','users.view'),
  ('manager','analytics.view'),('manager','audit.view'),('manager','health.view'),('manager','appearance.edit'),('manager','exams.manage'),
  -- support: inbox and account lookup
  ('support','overview.view'),('support','messages.view'),('support','messages.manage'),('support','users.view'),
  -- analyst (Viewer): read-only numbers
  ('analyst','overview.view'),('analyst','analytics.view'),('analyst','health.view'),('analyst','audit.view')
)
from (values ('administrator'),('manager'),('support'),('analyst')) as r(role)
cross join (values ('overview.view'),('messages.view'),('messages.manage'),('users.view'),('users.manage'),
  ('analytics.view'),('analytics.manage'),('audit.view'),('audit.export'),('health.view'),('security.view'),
  ('appearance.edit'),('appearance.publish'),('exams.manage'),('ai.manage'),('settings.site'),('settings.access'),('roles.manage')) as p(permission)
on conflict (role, permission) do nothing;

-- 4. Site status and access switches (one row). Public read: the website needs it to render.
create table if not exists public.site_settings (
  id smallint primary key default 1 check (id = 1),
  maintenance_enabled boolean not null default false,
  maintenance_message text not null default '' check (char_length(maintenance_message) <= 500),
  site_down boolean not null default false,
  signup_enabled boolean not null default true,
  signin_enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.site_settings enable row level security;
alter table public.site_settings force row level security;
revoke all on public.site_settings from anon, authenticated;
grant select (id, maintenance_enabled, maintenance_message, site_down, signup_enabled, signin_enabled, updated_at) on public.site_settings to anon, authenticated;
drop policy if exists site_settings_public_read on public.site_settings;
create policy site_settings_public_read on public.site_settings for select to anon, authenticated using (true);
create index if not exists site_settings_updated_by_idx on public.site_settings(updated_by);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

-- 5. Step-up: each fresh authenticator verification can authorize exactly one settings save.
create table if not exists public.control_step_up_uses (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null check (char_length(session_id) <= 80),
  mfa_at bigint not null,
  action text not null default '' check (char_length(action) <= 80),
  used_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, session_id, mfa_at)
);
alter table public.control_step_up_uses enable row level security;
alter table public.control_step_up_uses force row level security;
revoke all on public.control_step_up_uses from anon, authenticated;

-- 6. "Am I a role holder?" for the signed-in account only (used to let staff past site-down).
create or replace function public.is_control_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.control_roles
    where user_id = (select auth.uid()) and revoked_at is null
  );
$$;
revoke all on function public.is_control_member() from public, anon;
grant execute on function public.is_control_member() to authenticated;

-- 7. Immediate session revocation for a removed role holder (service role only).
create or replace function public.control_revoke_user_sessions(target uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  if target is null then return 0; end if;
  delete from auth.sessions where user_id = target;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.control_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.control_revoke_user_sessions(uuid) to service_role;

-- 8. Server-side enforcement of the access switches inside Supabase Auth.
--    Sign-ups off: no new auth user can be created (email, Google, or admin invite).
create or replace function public.site_enforce_signup_switch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
begin
  select signup_enabled into allowed from public.site_settings where id = 1;
  if coalesce(allowed, true) = false then
    raise exception 'signups_paused' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.site_enforce_signup_switch() from public, anon, authenticated;
drop trigger if exists site_enforce_signup_switch on auth.users;
create trigger site_enforce_signup_switch before insert on auth.users
  for each row execute function public.site_enforce_signup_switch();

--    Sign-ins off: no new session for an account without an active control role.
--    Existing sessions keep working; role holders are never blocked.
create or replace function public.site_enforce_signin_switch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
begin
  select signin_enabled into allowed from public.site_settings where id = 1;
  if coalesce(allowed, true) = false
     and not exists (select 1 from public.control_roles where user_id = new.user_id and revoked_at is null) then
    raise exception 'signins_paused' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.site_enforce_signin_switch() from public, anon, authenticated;
drop trigger if exists site_enforce_signin_switch on auth.sessions;
create trigger site_enforce_signin_switch before insert on auth.sessions
  for each row execute function public.site_enforce_signin_switch();
