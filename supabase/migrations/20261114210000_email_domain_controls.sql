-- Email-domain controls for the Control Centre (Settings → Email domains). Additive, forward-only.
--   * Built-in allowlist of mainstream providers: never checked, client or server.
--   * Owner rules: "allow" overrides the GitHub list; "block" adds to it.
--   * New permission settings.domains (owner by default; Admin can be given it in Permissions).

-- 1. Owner allow / block rules. Private: RLS on, no policies, no API grants (the console API
--    writes them with the service role after permission + step-up checks).
create table if not exists public.email_domain_rules (
  domain text primary key
    check (char_length(domain) between 3 and 253 and domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z0-9-]+$' and position('@' in domain) = 0),
  kind text not null check (kind in ('allow', 'block')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.email_domain_rules enable row level security;
alter table public.email_domain_rules force row level security;
revoke all on public.email_domain_rules from anon, authenticated;
create index if not exists email_domain_rules_created_by_idx on public.email_domain_rules(created_by);

-- 2. Built-in allowlist (kept identical to src/lib/email-domains.ts by a test).
create or replace function public.never_block_email_domain(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(p_domain, '')) = any (array[
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
    'rocketmail.com', 'yahoo.co.in', 'yahoo.in', 'yahoo.co.uk', 'yahoo.ca', 'yahoo.com.au', 'yahoo.fr', 'yahoo.de',
    'yahoo.es', 'yahoo.it', 'yahoo.co.jp', 'yahoo.com.br', 'yahoo.com.mx', 'yahoo.com.sg', 'yahoo.com.ph', 'yahoo.co.id',
    'icloud.com', 'me.com', 'mac.com', 'privaterelay.appleid.com', 'qq.com', 'foxmail.com', 'vip.qq.com', '163.com',
    '126.com', 'yeah.net', 'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'yandex.com', 'yandex.ru',
    'ya.ru', 'naver.com', 'aol.com', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'proton.me',
    'protonmail.com', 'pm.me', 'rediffmail.com', 'zohomail.com', 'zoho.com', 'comcast.net', 't-online.de', 'sina.com',
    'sina.com.cn', 'sina.net', 'orange.fr', 'wanadoo.fr', 'tuta.com', 'tutanota.com', 'tuta.io'
  ]);
$$;
revoke all on function public.never_block_email_domain(text) from public;

-- 3. The rule, in order: built-in allow → owner allow (domain or parent) → owner block (domain or
--    parent) → GitHub list (domain or parent).
create or replace function public.is_disposable_email(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  domain_name text;
  candidate text;
  candidates text[] := array[]::text[];
begin
  if p_email is null or char_length(p_email) > 320 then return false; end if;
  domain_name := rtrim(lower(substring(btrim(p_email) from '@([^@]+)$')), '.');
  if domain_name is null or char_length(domain_name) > 253 or position('.' in domain_name) = 0 then return false; end if;
  if public.never_block_email_domain(domain_name) then return false; end if;
  -- a.b.example.com → a.b.example.com, b.example.com, example.com (never the bare TLD).
  candidate := domain_name;
  while position('.' in candidate) > 0 loop
    candidates := candidates || candidate;
    candidate := substring(candidate from position('.' in candidate) + 1);
  end loop;
  if exists (select 1 from public.email_domain_rules where kind = 'allow' and domain = any (candidates)) then return false; end if;
  if exists (select 1 from public.email_domain_rules where kind = 'block' and domain = any (candidates)) then return true; end if;
  return exists (select 1 from public.disposable_email_domains where domain = any (candidates));
end;
$$;
revoke all on function public.is_disposable_email(text) from public;
grant execute on function public.is_disposable_email(text) to anon, authenticated, supabase_auth_admin;

-- 4. New permission: off for every editable role (the owner always has it).
insert into public.control_role_permissions (role, permission, allowed)
select r.role, 'settings.domains', false
from (values ('administrator'), ('moderator'), ('viewer')) as r(role)
on conflict (role, permission) do nothing;
