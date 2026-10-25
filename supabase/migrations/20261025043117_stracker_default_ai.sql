-- Stracker AI (Default): site-wide AI providers managed by the owner in the Control Center.
-- Server-only like ai_provider_configs: RLS is forced with no policies and all client
-- privileges are revoked, so only the service-role API (after owner + MFA checks) can read
-- or write. Credentials use the same server-side encryption as user providers.

create table if not exists public.site_ai_providers (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null check (provider_id in ('gemini','openai','anthropic','deepseek','qwen','custom')),
  display_name text not null check (char_length(display_name) between 1 and 80),
  encrypted_api_key text not null,
  key_hint text not null default '' check (char_length(key_hint) <= 4),
  model_id text not null check (char_length(model_id) between 1 and 200),
  base_url text,
  protocol text not null check (protocol in ('google','openai-compatible','anthropic-compatible')),
  organization_id text check (organization_id is null or char_length(organization_id) <= 160),
  provider_config jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  is_default boolean not null default false,
  connection_status text not null default 'not_tested'
    check (connection_status in ('not_tested','connected','authentication_failed','rate_limited','provider_unavailable','model_unavailable','configuration_incomplete','unsupported')),
  last_checked_at timestamptz,
  cooldown_until timestamptz,
  failure_count integer not null default 0 check (failure_count between 0 and 1000),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create unique index if not exists site_ai_providers_one_default_idx on public.site_ai_providers((true)) where is_default;

create table if not exists public.site_ai_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  per_user_per_minute integer not null default 4 check (per_user_per_minute between 1 and 60),
  per_user_daily integer not null default 40 check (per_user_daily between 1 and 1000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);
insert into public.site_ai_settings (id) values (1) on conflict (id) do nothing;

-- A student's explicit choice between Stracker AI (Default) and their own providers.
create table if not exists public.ai_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred text not null check (preferred in ('stracker','own')),
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
declare tbl text;
begin
  foreach tbl in array array['site_ai_providers','site_ai_settings','ai_user_preferences'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('alter table public.%I force row level security', tbl);
    execute format('revoke all on table public.%I from anon, authenticated', tbl);
  end loop;
end $$;

-- Conversation records may name 'stracker' (the default) instead of the underlying vendor.
alter table public.ai_messages drop constraint if exists ai_messages_provider_id_check;
alter table public.ai_messages add constraint ai_messages_provider_id_check
  check (provider_id is null or provider_id in ('gemini','openai','anthropic','deepseek','qwen','custom','stracker'));
alter table public.ai_tasks drop constraint if exists ai_tasks_provider_id_check;
alter table public.ai_tasks add constraint ai_tasks_provider_id_check
  check (provider_id is null or provider_id in ('gemini','openai','anthropic','deepseek','qwen','custom','stracker'));
alter table public.ai_action_audit drop constraint if exists ai_action_audit_provider_id_check;
alter table public.ai_action_audit add constraint ai_action_audit_provider_id_check
  check (provider_id is null or provider_id in ('gemini','openai','anthropic','deepseek','qwen','custom','stracker'));
