-- Stracker Master MCP: dedicated credentials, confirmation tokens, audit trail and rate slots.
--
-- Additive only. Does not alter control_roles, control_role_permissions,
-- control_member_permissions, owner protections, passkey triggers, or existing RLS.
--
-- These tables are server-only. anon and authenticated clients cannot read token hashes
-- or change connection records. The Master MCP process uses the service-role client
-- behind its own permission boundary; that client must never reach a browser or tool response.
--
-- Do not apply this migration to production without explicit Owner authorization.

create table if not exists public.master_mcp_credentials (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  token_hash text not null,
  token_hint text not null,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid references auth.users (id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  constraint master_mcp_credentials_name check (char_length(display_name) between 1 and 80),
  constraint master_mcp_credentials_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint master_mcp_credentials_hint check (char_length(token_hint) between 1 and 16),
  constraint master_mcp_credentials_status check (status in ('active', 'revoked')),
  constraint master_mcp_credentials_revoked_consistent check ((status = 'revoked') = (revoked_at is not null))
);

create unique index if not exists master_mcp_credentials_token_hash_idx
  on public.master_mcp_credentials (token_hash);
create index if not exists master_mcp_credentials_status_idx
  on public.master_mcp_credentials (status, created_at desc);

create table if not exists public.master_mcp_confirmation_tokens (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references public.master_mcp_credentials (id) on delete cascade,
  token_hash text not null,
  tool_name text not null,
  target_type text,
  target_id text,
  target_student_id uuid,
  argument_digest text not null,
  resource_version text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint master_mcp_confirmation_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint master_mcp_confirmation_digest check (argument_digest ~ '^[0-9a-f]{64}$'),
  constraint master_mcp_confirmation_tool check (char_length(tool_name) between 1 and 80),
  constraint master_mcp_confirmation_target_type check (target_type is null or char_length(target_type) <= 40),
  constraint master_mcp_confirmation_target_id check (target_id is null or char_length(target_id) <= 120),
  constraint master_mcp_confirmation_version check (resource_version is null or char_length(resource_version) <= 80)
);

create unique index if not exists master_mcp_confirmation_token_hash_idx
  on public.master_mcp_confirmation_tokens (token_hash);
create index if not exists master_mcp_confirmation_expiry_idx
  on public.master_mcp_confirmation_tokens (expires_at);
create index if not exists master_mcp_confirmation_credential_idx
  on public.master_mcp_confirmation_tokens (credential_id, created_at desc);

create table if not exists public.master_mcp_audit_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default timezone('utc', now()),
  request_id text,
  credential_id uuid references public.master_mcp_credentials (id) on delete set null,
  credential_label text,
  tool_name text,
  action text not null,
  target_type text,
  target_id text,
  target_student_id uuid,
  result text not null,
  error_category text,
  reason text,
  changed_fields text[],
  before_summary jsonb,
  after_summary jsonb,
  related_version text,
  related_task_id text,
  constraint master_mcp_audit_action check (char_length(action) between 1 and 80),
  constraint master_mcp_audit_result check (result in ('success', 'denied', 'failed')),
  constraint master_mcp_audit_request_id check (request_id is null or char_length(request_id) <= 80),
  constraint master_mcp_audit_label check (credential_label is null or char_length(credential_label) <= 80),
  constraint master_mcp_audit_tool check (tool_name is null or char_length(tool_name) <= 80),
  constraint master_mcp_audit_target_type check (target_type is null or char_length(target_type) <= 40),
  constraint master_mcp_audit_target_id check (target_id is null or char_length(target_id) <= 120),
  constraint master_mcp_audit_error check (error_category is null or char_length(error_category) <= 60),
  constraint master_mcp_audit_reason check (reason is null or char_length(reason) <= 500)
);

create index if not exists master_mcp_audit_created_idx
  on public.master_mcp_audit_events (created_at desc);
create index if not exists master_mcp_audit_credential_idx
  on public.master_mcp_audit_events (credential_id, created_at desc);
create index if not exists master_mcp_audit_tool_idx
  on public.master_mcp_audit_events (tool_name, created_at desc);

create table if not exists public.master_mcp_rate_events (
  id bigint generated always as identity primary key,
  actor_key text not null,
  bucket text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint master_mcp_rate_actor check (char_length(actor_key) between 1 and 80),
  constraint master_mcp_rate_bucket check (char_length(bucket) between 1 and 40)
);

create index if not exists master_mcp_rate_actor_bucket_idx
  on public.master_mcp_rate_events (actor_key, bucket, created_at desc);

-- Server-only access. FORCE RLS so even table owners cannot bypass policies.
-- No policies are granted to anon or authenticated, so those roles cannot read or write.
alter table public.master_mcp_credentials enable row level security;
alter table public.master_mcp_credentials force row level security;
alter table public.master_mcp_confirmation_tokens enable row level security;
alter table public.master_mcp_confirmation_tokens force row level security;
alter table public.master_mcp_audit_events enable row level security;
alter table public.master_mcp_audit_events force row level security;
alter table public.master_mcp_rate_events enable row level security;
alter table public.master_mcp_rate_events force row level security;

revoke all on table public.master_mcp_credentials from public, anon, authenticated;
revoke all on table public.master_mcp_confirmation_tokens from public, anon, authenticated;
revoke all on table public.master_mcp_audit_events from public, anon, authenticated;
revoke all on table public.master_mcp_rate_events from public, anon, authenticated;

grant select, insert, update on table public.master_mcp_credentials to service_role;
grant select, insert, update on table public.master_mcp_confirmation_tokens to service_role;
grant select, insert on table public.master_mcp_audit_events to service_role;
grant select, insert, delete on table public.master_mcp_rate_events to service_role;

revoke update, delete, truncate on table public.master_mcp_audit_events from public, anon, authenticated, service_role;

-- Append-only audit trail: block UPDATE, DELETE and TRUNCATE even for service_role.
create or replace function public.master_mcp_audit_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'master_mcp_audit_events is append-only' using errcode = 'P0001';
end;
$$;

drop trigger if exists master_mcp_audit_no_update on public.master_mcp_audit_events;
create trigger master_mcp_audit_no_update
  before update or delete on public.master_mcp_audit_events
  for each row
  execute function public.master_mcp_audit_append_only();

drop trigger if exists master_mcp_audit_no_truncate on public.master_mcp_audit_events;
create trigger master_mcp_audit_no_truncate
  before truncate on public.master_mcp_audit_events
  for each statement
  execute function public.master_mcp_audit_append_only();

revoke all on function public.master_mcp_audit_append_only() from public, anon, authenticated;

-- Atomic rate slot used only by the Master MCP server after it has authenticated the caller
-- (or, for anonymous failures, after hashing the client address). anon/authenticated cannot
-- execute it, so a browser cannot consume or skip a credential's budget.
create or replace function public.master_mcp_take_rate_slot(
  actor_key text,
  bucket text,
  per_limit integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  taken integer;
begin
  if actor_key is null
     or char_length(actor_key) not between 1 and 80
     or bucket is null
     or char_length(bucket) not between 1 and 40
     or per_limit is null
     or per_limit < 1
     or per_limit > 10000
     or window_seconds is null
     or window_seconds < 1
     or window_seconds > 86400 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('stracker-master-mcp-rate'), hashtext(actor_key || ':' || bucket));

  delete from public.master_mcp_rate_events
  where master_mcp_rate_events.actor_key = master_mcp_take_rate_slot.actor_key
    and master_mcp_rate_events.bucket = master_mcp_take_rate_slot.bucket
    and created_at < timezone('utc', now()) - make_interval(secs => window_seconds);

  select count(*) into taken
  from public.master_mcp_rate_events
  where master_mcp_rate_events.actor_key = master_mcp_take_rate_slot.actor_key
    and master_mcp_rate_events.bucket = master_mcp_take_rate_slot.bucket
    and created_at > timezone('utc', now()) - make_interval(secs => window_seconds);

  if taken >= per_limit then
    return false;
  end if;

  insert into public.master_mcp_rate_events (actor_key, bucket)
  values (actor_key, bucket);
  return true;
end;
$$;

revoke all on function public.master_mcp_take_rate_slot(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.master_mcp_take_rate_slot(text, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
