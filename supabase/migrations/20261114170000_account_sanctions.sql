-- Phase 5: account sanctions (warn / ban), one-time notices, and ban enforcement.
-- Additive and forward-only. Existing RLS is preserved; a RESTRICTIVE policy is layered on top
-- of the student tables so a banned account's still-valid access token (JWTs are stateless for up
-- to an hour) can no longer read or write study data through PostgREST or Storage.

-- 1. Active bans: at most one row per account, primary-key lookup. banned_until null = permanent.
create table if not exists public.account_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  banned_until timestamptz,
  reason text not null check (char_length(reason) between 3 and 500),
  sanction_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);
alter table public.account_bans enable row level security;
alter table public.account_bans force row level security;
revoke all on public.account_bans from anon, authenticated;
create index if not exists account_bans_created_by_idx on public.account_bans(created_by);

-- 2. Sanction history, which doubles as the one-time notice queue (acknowledged_at null = pending).
create table if not exists public.account_sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('warning', 'ban', 'unban', 'ban_ended')),
  reason text check (reason is null or char_length(reason) <= 500),
  banned_until timestamptz,
  permanent boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_by_role text check (created_by_role is null or char_length(created_by_role) <= 30),
  created_at timestamptz not null default timezone('utc', now()),
  acknowledged_at timestamptz
);
alter table public.account_sanctions enable row level security;
alter table public.account_sanctions force row level security;
revoke all on public.account_sanctions from anon, authenticated;
create index if not exists account_sanctions_user_created_idx on public.account_sanctions(user_id, created_at desc);
create index if not exists account_sanctions_pending_idx on public.account_sanctions(user_id, created_at) where acknowledged_at is null;
create index if not exists account_sanctions_created_by_idx on public.account_sanctions(created_by);

-- 3. Private signing key for device notice tokens (never exposed through the API).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.account_notice_keys (
  id smallint primary key default 1 check (id = 1),
  secret bytea not null
);
revoke all on private.account_notice_keys from public, anon, authenticated;
insert into private.account_notice_keys (id, secret) values (1, extensions.gen_random_bytes(32)) on conflict (id) do nothing;

-- 4. Lightweight ban check for the signed-in caller (PK lookup; evaluated once per statement via
--    the (select ...) initplan in policies). Takes no argument so it cannot be used to probe others.
create or replace function public.current_account_banned()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.account_bans b
    where b.user_id = auth.uid()
      and (b.banned_until is null or b.banned_until > timezone('utc', now()))
  );
$$;
revoke all on function public.current_account_banned() from public, anon;
grant execute on function public.current_account_banned() to authenticated, service_role;

-- 5. Restrictive policies: a banned account can do nothing on student tables, even with an old token.
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings','backlog_items','chapter_revisions','chapter_stages','chapters','daily_tasks','mistakes',
    'practice_sessions','profiles','pyq_records','study_cards','study_sessions','test_chapter_links',
    'test_error_logs','test_subject_scores','test_time_entries','tests','user_exam_tracks','weekly_goals'
  ] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'account not banned'
    ) then
      execute format(
        'create policy "account not banned" on public.%I as restrictive for all to authenticated using ((select not public.current_account_banned())) with check ((select not public.current_account_banned()))',
        t
      );
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'account not banned') then
    create policy "account not banned" on storage.objects as restrictive for all to authenticated
      using ((select not public.current_account_banned()))
      with check ((select not public.current_account_banned()));
  end if;
end $$;

-- 6. Device notice token: "<uid>.<expiry epoch>.<hex hmac>". Lets the sign-in page explain a ban
--    to the device that last held the account (Google sign-in returns no identity when banned).
create or replace function public.account_notice_token_for(target uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  k bytea;
  payload text;
begin
  select secret into k from private.account_notice_keys where id = 1;
  if k is null or target is null then return null; end if;
  payload := target::text || '.' || (extract(epoch from timezone('utc', now()))::bigint + 180 * 86400)::text;
  return payload || '.' || encode(extensions.hmac(payload::bytea, k, 'sha256'), 'hex');
end;
$$;
revoke all on function public.account_notice_token_for(uuid) from public, anon, authenticated;

create or replace function public.account_ban_details(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'kind', 'ban',
    'reason', b.reason,
    'until', b.banned_until,
    'permanent', b.banned_until is null
  )
  from public.account_bans b
  where b.user_id = target and (b.banned_until is null or b.banned_until > timezone('utc', now()));
$$;
revoke all on function public.account_ban_details(uuid) from public, anon, authenticated;

-- 7. The signed-in student's pending notice (one call on dashboard open). Also lazily records
--    "your suspension ended" when a temporary ban has expired, and returns a fresh device token.
create or replace function public.my_account_notice()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ban public.account_bans%rowtype;
  n public.account_sanctions%rowtype;
  details jsonb;
begin
  if uid is null then return null; end if;
  select * into ban from public.account_bans where user_id = uid;
  if found and ban.banned_until is not null and ban.banned_until <= timezone('utc', now()) then
    delete from public.account_bans where user_id = uid;
    update public.account_sanctions set acknowledged_at = timezone('utc', now())
      where user_id = uid and kind = 'ban' and acknowledged_at is null;
    insert into public.account_sanctions (user_id, kind, banned_until) values (uid, 'ban_ended', ban.banned_until);
  end if;

  details := public.account_ban_details(uid);
  if details is not null then
    select * into n from public.account_sanctions where user_id = uid and kind = 'ban' order by created_at desc limit 1;
    return jsonb_build_object(
      'notice', details || jsonb_build_object('id', n.id, 'createdAt', n.created_at),
      'token', public.account_notice_token_for(uid)
    );
  end if;

  -- Not banned: a ban that was lifted before it was seen no longer needs its own popup.
  update public.account_sanctions set acknowledged_at = timezone('utc', now())
    where user_id = uid and kind = 'ban' and acknowledged_at is null;
  select * into n from public.account_sanctions
    where user_id = uid and acknowledged_at is null
    order by created_at asc limit 1;
  return jsonb_build_object(
    'notice', case when n.id is null then null else jsonb_build_object(
      'id', n.id, 'kind', n.kind, 'reason', n.reason, 'until', n.banned_until,
      'permanent', n.permanent, 'createdAt', n.created_at) end,
    'token', public.account_notice_token_for(uid)
  );
end;
$$;
revoke all on function public.my_account_notice() from public, anon;
grant execute on function public.my_account_notice() to authenticated;

create or replace function public.acknowledge_account_notice(notice_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  if auth.uid() is null or notice_id is null then return false; end if;
  update public.account_sanctions set acknowledged_at = timezone('utc', now())
    where id = notice_id and user_id = auth.uid() and acknowledged_at is null;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;
revoke all on function public.acknowledge_account_notice(uuid) from public, anon;
grant execute on function public.acknowledge_account_notice(uuid) to authenticated;

-- 8. Sign-in page, Google path: ban details for the account this device last held, proven by an
--    HMAC token the server issued to that signed-in account. A forged or expired token gets null.
create or replace function public.account_ban_notice_for_token(token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  parts text[];
  k bytea;
  target uuid;
begin
  if token is null or char_length(token) > 200 then return null; end if;
  parts := string_to_array(token, '.');
  if array_length(parts, 1) <> 3 or parts[1] !~ '^[0-9a-f-]{36}$' or parts[2] !~ '^[0-9]{1,12}$' or parts[3] !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select secret into k from private.account_notice_keys where id = 1;
  if k is null or encode(extensions.hmac((parts[1] || '.' || parts[2])::bytea, k, 'sha256'), 'hex') <> parts[3] then
    return null;
  end if;
  if parts[2]::bigint < extract(epoch from timezone('utc', now()))::bigint then return null; end if;
  target := parts[1]::uuid;
  return public.account_ban_details(target);
end;
$$;
revoke all on function public.account_ban_notice_for_token(text) from public;
grant execute on function public.account_ban_notice_for_token(text) to anon, authenticated;

-- 9. Sign-in page, email + password path. Supabase Auth answers "user_banned" before checking the
--    password, so the reason is only revealed after this function proves the password itself.
--    Constant work (one bcrypt compare, against a throwaway hash when the account is unknown), and
--    rate limited per email (hashed, never stored raw) and globally. Never logs the password.
create or replace function public.account_ban_notice_for_credentials(email text, password text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  normalized text := lower(trim(coalesce(email, '')));
  stored text;
  target uuid;
  dummy constant text := '$2a$10$Jh4H1FYZ8JiQFxy6NeW3BetZlZiUesBy/.Hr065wTMrVOLOD.uh2m';
  proven boolean;
begin
  if normalized = '' or char_length(normalized) > 320 or password is null or char_length(password) > 200 then
    return null;
  end if;
  if not public.control_take_rate_slot('ban-notice:global', 'ban-notice-global', 600, 60)
     or not public.control_take_rate_slot('ban-notice:' || encode(extensions.digest(normalized, 'sha256'), 'hex'), 'ban-notice', 5, 900) then
    return jsonb_build_object('limited', true);
  end if;
  select u.id, u.encrypted_password into target, stored
    from auth.users u where lower(u.email) = normalized and u.deleted_at is null limit 1;
  proven := extensions.crypt(password, coalesce(nullif(stored, ''), dummy)) = coalesce(nullif(stored, ''), dummy)
    and target is not null and coalesce(stored, '') <> '';
  if not proven then return null; end if;
  return public.account_ban_details(target);
end;
$$;
revoke all on function public.account_ban_notice_for_credentials(text, text) from public;
grant execute on function public.account_ban_notice_for_credentials(text, text) to anon, authenticated;

-- 10. New console permissions. Admin: warn + ban. Moderator: warn. Viewer: none. Delete: owner only
--     by default (the owner may grant it per role or per person later).
insert into public.control_role_permissions (role, permission, allowed)
select r.role, p.permission, (r.role, p.permission) in (
  ('administrator', 'users.warn'), ('administrator', 'users.ban'), ('moderator', 'users.warn')
)
from (values ('administrator'), ('moderator'), ('viewer')) as r(role)
cross join (values ('users.warn'), ('users.ban'), ('users.delete')) as p(permission)
on conflict (role, permission) do nothing;
