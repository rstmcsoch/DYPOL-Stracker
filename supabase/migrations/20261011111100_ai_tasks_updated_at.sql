-- ai_tasks has a BEFORE UPDATE set_updated_at trigger but no updated_at column, so every UPDATE
-- failed ("record new has no field updated_at"). Tasks could never leave 'running' (failed,
-- cancelled, completed), which produced "A Stracker AI task is already running" and broke Stop.
-- Additive fix: add the column. Then release only stale running tasks (older than 5 minutes);
-- no conversation, message or student record is touched.
alter table public.ai_tasks add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.ai_tasks
   set status = 'failed', progress = 'Stopped: this request did not finish.', completed_at = timezone('utc', now())
 where status in ('queued','running','tool_call','fallback','retrying')
   and started_at < timezone('utc', now()) - interval '5 minutes';

create index if not exists ai_tasks_active_by_conversation
  on public.ai_tasks (user_id, conversation_id, started_at desc)
  where status in ('queued','running','tool_call','fallback','retrying');
