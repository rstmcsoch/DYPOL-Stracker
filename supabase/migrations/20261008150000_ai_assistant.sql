-- Stracker AI: server-only BYOK configuration, conversation/task persistence, and action audit.
-- The browser cannot query these tables. Vercel functions authenticate the owner, then
-- access only that owner's rows through a server-side service-role client.

create table if not exists public.ai_provider_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, id)
);
create unique index if not exists ai_provider_one_default_per_user_idx
  on public.ai_provider_configs(user_id) where is_default;
create index if not exists ai_provider_configs_user_idx
  on public.ai_provider_configs(user_id, enabled, updated_at desc);

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) <= 160),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, id)
);
create index if not exists ai_conversations_user_updated_idx
  on public.ai_conversations(user_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) <= 20000),
  provider_id text check (provider_id is null or provider_id in ('gemini','openai','anthropic','deepseek','qwen','custom')),
  model_id text check (model_id is null or char_length(model_id) <= 200),
  status text not null default 'completed' check (status in ('queued','running','completed','failed','cancelled','waiting')),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) <= 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (user_id, conversation_id) references public.ai_conversations(user_id, id) on delete cascade,
  unique (user_id, id)
);
create unique index if not exists ai_messages_idempotency_idx
  on public.ai_messages(user_id, idempotency_key) where idempotency_key is not null;
create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages(user_id, conversation_id, created_at);

create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  request_id text not null check (char_length(request_id) between 1 and 100),
  provider_id text check (provider_id is null or provider_id in ('gemini','openai','anthropic','deepseek','qwen','custom')),
  model_id text check (model_id is null or char_length(model_id) <= 200),
  task_type text not null default 'chat' check (task_type in ('chat','analytics','action','general')),
  status text not null default 'queued' check (status in ('queued','running','tool_call','waiting','completed','failed','cancelled','fallback','retrying')),
  progress text not null default '' check (char_length(progress) <= 240),
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  foreign key (user_id, conversation_id) references public.ai_conversations(user_id, id) on delete cascade,
  unique (user_id, request_id),
  unique (user_id, id)
);
create index if not exists ai_tasks_user_recent_idx on public.ai_tasks(user_id, started_at desc);
create index if not exists ai_tasks_active_idx on public.ai_tasks(user_id, status) where status in ('queued','running','tool_call','waiting','retrying');

create table if not exists public.ai_pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  conversation_id uuid not null,
  tool_name text not null check (char_length(tool_name) between 1 and 100),
  tool_call_key text not null check (char_length(tool_call_key) between 1 and 120),
  input jsonb not null,
  summary jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','executing','completed','cancelled','failed','expired')),
  result jsonb,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '15 minutes'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (user_id, task_id) references public.ai_tasks(user_id, id) on delete cascade,
  foreign key (user_id, conversation_id) references public.ai_conversations(user_id, id) on delete cascade,
  unique (user_id, task_id, tool_call_key)
);
create index if not exists ai_pending_actions_owner_status_idx on public.ai_pending_actions(user_id, status, expires_at);

create table if not exists public.ai_action_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid,
  provider_id text check (provider_id is null or provider_id in ('gemini','openai','anthropic','deepseek','qwen','custom')),
  model_id text check (model_id is null or char_length(model_id) <= 200),
  tool_name text not null check (char_length(tool_name) between 1 and 100),
  action text not null check (char_length(action) between 1 and 120),
  success boolean not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (user_id, task_id) references public.ai_tasks(user_id, id) on delete cascade
);
create index if not exists ai_action_audit_user_created_idx on public.ai_action_audit(user_id, created_at desc);

-- No authenticated/anon browser role can read encrypted credentials, AI messages, or tools.
-- The backend uses service_role only after authenticating the user's Supabase JWT and
-- explicitly filtering every query by the authenticated user UUID.
do $$
declare tbl text;
begin
  foreach tbl in array array['ai_provider_configs','ai_conversations','ai_messages','ai_tasks','ai_pending_actions','ai_action_audit'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists "owner manages own rows" on public.%I', tbl);
    execute format('revoke all on table public.%I from anon, authenticated', tbl);
    execute format('grant all on table public.%I to service_role', tbl);
    execute format('drop trigger if exists set_updated_at on public.%I', tbl);
    if tbl not in ('ai_messages','ai_action_audit') then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', tbl);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
