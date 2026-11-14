-- Anti-spam: refuse new accounts whose email uses a temporary / disposable domain.
-- Source: the open GitHub list disposable-email-domains/disposable-email-domains (the normal
-- `disposable_email_blocklist.conf`, not a strict list). Additive and forward-only: existing
-- accounts are never touched (only INSERTs into auth.users are checked).
--
-- Enforcement is server-side and cannot be bypassed from a browser:
--   * a BEFORE INSERT trigger on auth.users (covers email sign-up, Google sign-up and admin
--     creation; Supabase Auth reports it as "Database error saving new user");
--   * an optional Supabase Auth "Before User Created" hook function with the same rule, which
--     returns the friendly message directly when it is enabled in Auth → Hooks.
-- The web app also asks `is_disposable_email` in sign-up step 1 for instant feedback.

-- 1. Blocked domains. Private: RLS on, no policies, no grants to API roles.
create table if not exists public.disposable_email_domains (
  domain text primary key
    check (char_length(domain) between 3 and 253 and domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z0-9-]+$'),
  added_at timestamptz not null default timezone('utc', now())
);
alter table public.disposable_email_domains enable row level security;
alter table public.disposable_email_domains force row level security;
revoke all on public.disposable_email_domains from anon, authenticated;

-- 2. Mainstream and privacy-relay providers that must never be blocked, whatever the list says.
create or replace function public.never_block_email_domain(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(p_domain, '')) = any (array[
    'gmail.com', 'googlemail.com',
    'outlook.com', 'outlook.in', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.in', 'msn.com',
    'icloud.com', 'me.com', 'mac.com', 'privaterelay.appleid.com',
    'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'rocketmail.com',
    'proton.me', 'protonmail.com', 'pm.me', 'duck.com',
    'aol.com', 'zoho.com', 'zohomail.in', 'rediffmail.com', 'gmx.com', 'gmx.net', 'mail.com',
    'yandex.com', 'tutanota.com', 'tuta.io', 'fastmail.com'
  ]);
$$;
revoke all on function public.never_block_email_domain(text) from public;

-- 3. The rule: the email's domain, or any parent domain, is on the list.
create or replace function public.is_disposable_email(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  candidate text;
begin
  if p_email is null or char_length(p_email) > 320 then return false; end if;
  candidate := rtrim(lower(substring(btrim(p_email) from '@([^@]+)$')), '.');
  if candidate is null or char_length(candidate) > 253 or position('.' in candidate) = 0 then return false; end if;
  if public.never_block_email_domain(candidate) then return false; end if;
  -- a.b.example.com → a.b.example.com, b.example.com, example.com (never the bare TLD).
  while position('.' in candidate) > 0 loop
    if exists (select 1 from public.disposable_email_domains where domain = candidate) then return true; end if;
    candidate := substring(candidate from position('.' in candidate) + 1);
  end loop;
  return false;
end;
$$;
revoke all on function public.is_disposable_email(text) from public;
-- Answers only true/false for one address (the list itself is public on GitHub).
grant execute on function public.is_disposable_email(text) to anon, authenticated, supabase_auth_admin;

-- 4. Authoritative check on every new account.
create or replace function public.site_block_disposable_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and public.is_disposable_email(new.email) then
    raise exception 'disposable_email_not_allowed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.site_block_disposable_email() from public, anon, authenticated;
drop trigger if exists site_block_disposable_email on auth.users;
create trigger site_block_disposable_email
  before insert on auth.users
  for each row execute function public.site_block_disposable_email();

-- 5. Optional Auth hook (enable in Supabase → Authentication → Hooks → Before User Created).
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.is_disposable_email(event -> 'user' ->> 'email') then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'Temporary or disposable email addresses aren''t allowed. Please use your regular email.'
    ));
  end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- 6. Weekly refresh from GitHub, entirely inside the database (pg_net + pg_cron, no secrets).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.disposable_email_domain_refreshes (
  id bigserial primary key,
  request_id bigint,
  requested_at timestamptz not null default timezone('utc', now()),
  applied_at timestamptz,
  outcome text check (outcome is null or char_length(outcome) <= 60),
  domain_count integer
);
alter table public.disposable_email_domain_refreshes enable row level security;
alter table public.disposable_email_domain_refreshes force row level security;
revoke all on public.disposable_email_domain_refreshes from anon, authenticated;

create or replace function public.disposable_domains_refresh_request()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  request bigint;
begin
  request := net.http_get(
    url := 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf',
    timeout_milliseconds := 20000
  );
  insert into public.disposable_email_domain_refreshes (request_id) values (request);
  return request;
end;
$$;
revoke all on function public.disposable_domains_refresh_request() from public, anon, authenticated;

-- Applies the newest pending download. Refuses implausible downloads (fewer than 1,000 valid
-- domains), so a bad or truncated response can never empty the list.
create or replace function public.disposable_domains_refresh_apply()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending public.disposable_email_domain_refreshes%rowtype;
  response_status integer;
  response_body text;
  total integer;
begin
  select * into pending from public.disposable_email_domain_refreshes
    where applied_at is null order by id desc limit 1;
  if not found then return 'nothing_pending'; end if;

  select r.status_code, r.content into response_status, response_body
    from net._http_response r where r.id = pending.request_id;
  if not found then
    if pending.requested_at > timezone('utc', now()) - interval '2 hours' then return 'waiting'; end if;
    update public.disposable_email_domain_refreshes set applied_at = timezone('utc', now()), outcome = 'no_response' where id = pending.id;
    return 'no_response';
  end if;
  if response_status is distinct from 200 or response_body is null then
    update public.disposable_email_domain_refreshes set applied_at = timezone('utc', now()), outcome = 'http_' || coalesce(response_status::text, 'error') where id = pending.id;
    return 'http_' || coalesce(response_status::text, 'error');
  end if;

  create temporary table if not exists disposable_domains_incoming (domain text primary key) on commit drop;
  truncate disposable_domains_incoming;
  insert into disposable_domains_incoming (domain)
    select distinct d from (
      select lower(btrim(line)) as d from regexp_split_to_table(response_body, E'\n') as line
    ) lines
    where char_length(d) between 3 and 253
      and d ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      and not public.never_block_email_domain(d);
  select count(*) into total from disposable_domains_incoming;
  if total < 1000 then
    update public.disposable_email_domain_refreshes set applied_at = timezone('utc', now()), outcome = 'too_small', domain_count = total where id = pending.id;
    return 'too_small';
  end if;

  insert into public.disposable_email_domains (domain)
    select domain from disposable_domains_incoming
    on conflict (domain) do nothing;
  delete from public.disposable_email_domains existing
    where not exists (select 1 from disposable_domains_incoming i where i.domain = existing.domain);
  update public.disposable_email_domain_refreshes set applied_at = timezone('utc', now()), outcome = 'applied', domain_count = total where id = pending.id;
  return 'applied';
end;
$$;
revoke all on function public.disposable_domains_refresh_apply() from public, anon, authenticated;

-- Download every Sunday 03:17 UTC (08:47 IST); apply hourly (a no-op when nothing is pending).
select cron.schedule('stracker-disposable-domains-request', '17 3 * * 0', $$select public.disposable_domains_refresh_request()$$);
select cron.schedule('stracker-disposable-domains-apply', '47 * * * *', $$select public.disposable_domains_refresh_apply()$$);

-- First download right away; the hourly apply job (or a manual apply) loads it.
select public.disposable_domains_refresh_request();
