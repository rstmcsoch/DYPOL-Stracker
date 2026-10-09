-- Atomic AI rate slots, and tighter defaults for tables created after this migration.
-- Existing notebook grants are unchanged. New public tables are not exposed until
-- a migration grants them explicitly and adds owner-only RLS.

create table if not exists public.ai_rate_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (char_length(bucket) between 1 and 40),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_rate_events_user_bucket_idx
  on public.ai_rate_events (user_id, bucket, created_at desc);

alter table public.ai_rate_events enable row level security;
alter table public.ai_rate_events force row level security;
revoke all on table public.ai_rate_events from anon, authenticated;
grant all on table public.ai_rate_events to service_role;

-- Called only by the server after it has verified the Supabase JWT. The owner
-- argument is that verified user id. authenticated/anon cannot execute it, so a
-- browser cannot consume another account's budget or skip the check.
create or replace function public.ai_take_rate_slot(owner uuid, bucket text, per_user_limit integer, window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  taken integer;
begin
  if owner is null
     or bucket is null
     or char_length(bucket) not between 1 and 40
     or per_user_limit is null
     or per_user_limit < 1
     or per_user_limit > 1000
     or window_seconds is null
     or window_seconds < 1
     or window_seconds > 86400 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('stracker-ai-rate'), hashtext(owner::text || ':' || bucket));

  delete from public.ai_rate_events
  where user_id = owner
    and ai_rate_events.bucket = ai_take_rate_slot.bucket
    and created_at < timezone('utc', now()) - make_interval(secs => window_seconds);

  select count(*) into taken
  from public.ai_rate_events
  where user_id = owner
    and ai_rate_events.bucket = ai_take_rate_slot.bucket
    and created_at > timezone('utc', now()) - make_interval(secs => window_seconds);

  if taken >= per_user_limit then
    return false;
  end if;

  insert into public.ai_rate_events (user_id, bucket) values (owner, bucket);
  return true;
end;
$$;

revoke all on function public.ai_take_rate_slot(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_take_rate_slot(uuid, text, integer, integer) to service_role;

-- Table owners that are not superusers must still obey RLS. service_role keeps
-- BYPASSRLS, which the AI functions need after the JWT check.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'profiles','app_settings','chapters','chapter_revisions','tests','test_subject_scores',
    'test_chapter_links','mistakes','daily_tasks','weekly_goals','study_sessions',
    'practice_sessions','pyq_records','chapter_stages','backlog_items','study_cards',
    'test_error_logs','test_time_entries','user_exam_tracks',
    'ai_provider_configs','ai_conversations','ai_messages','ai_tasks','ai_pending_actions','ai_action_audit'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('alter table public.%I force row level security', tbl);
    end if;
  end loop;
end $$;

alter default privileges in schema public revoke select, insert, update, delete on tables from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke usage, select on sequences from authenticated, anon;

notify pgrst, 'reload schema';
