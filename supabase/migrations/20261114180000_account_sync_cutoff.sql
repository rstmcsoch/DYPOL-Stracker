-- Phase 6: changes a student made while banned are never synced, even after the ban ends.
-- Additive and forward-only.
--
-- Stracker is offline-first: edits are stored in the browser and replayed later from a queue.
-- While a ban is active, RLS refuses every write. After it ends, anything stamped before the end
-- of the ban (queued during the ban, or before it and never synced) is silently skipped, so a
-- replayed queue cannot resurrect it. Only edits made after the ban ended reach the database.

create table if not exists public.account_sync_cutoffs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cutoff timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.account_sync_cutoffs enable row level security;
alter table public.account_sync_cutoffs force row level security;
revoke all on public.account_sync_cutoffs from anon, authenticated;

-- Keep the cutoff in step with account_bans: a temporary ban's cutoff is its end, a permanent
-- ban's is infinity, and lifting a ban early moves the cutoff to the moment it was lifted. A
-- ban that simply expired keeps its end time as the cutoff.
create or replace function public.account_bans_sync_cutoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.banned_until is null or old.banned_until > timezone('utc', now()) then
      insert into public.account_sync_cutoffs (user_id, cutoff) values (old.user_id, timezone('utc', now()))
      on conflict (user_id) do update set cutoff = excluded.cutoff, updated_at = timezone('utc', now());
    end if;
    return old;
  end if;
  insert into public.account_sync_cutoffs (user_id, cutoff)
  values (new.user_id, coalesce(new.banned_until, 'infinity'::timestamptz))
  on conflict (user_id) do update set cutoff = excluded.cutoff, updated_at = timezone('utc', now());
  return new;
end;
$$;
revoke all on function public.account_bans_sync_cutoff() from public, anon, authenticated;

drop trigger if exists account_bans_sync_cutoff on public.account_bans;
create trigger account_bans_sync_cutoff
  after insert or update or delete on public.account_bans
  for each row execute function public.account_bans_sync_cutoff();

-- Backfill for bans that already exist.
insert into public.account_sync_cutoffs (user_id, cutoff)
select user_id, coalesce(banned_until, 'infinity'::timestamptz) from public.account_bans
on conflict (user_id) do nothing;

-- Student writes (role authenticated only; the service role and console are unaffected).
-- The operation time is the client's queue time sent as the x-stracker-op-at header by the
-- sync queue; without it (older app bundles), the row's updated_at with five minutes' grace for
-- clock drift. Operations older than the cutoff are skipped (returning NULL), so the client's
-- queue drains normally and then reloads the server copy. One primary-key lookup per row, and
-- only accounts that were ever banned have a cutoff at all.
create or replace function public.enforce_account_sync_cutoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb;
  c timestamptz;
  op_at timestamptz;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    claims := null;
  end;
  if coalesce(claims->>'role', '') <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select s.cutoff into c from public.account_sync_cutoffs s where s.user_id = (claims->>'sub')::uuid;
  if c is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  begin
    op_at := nullif(nullif(current_setting('request.headers', true), '')::jsonb->>'x-stracker-op-at', '')::timestamptz;
  exception when others then
    op_at := null;
  end;
  if op_at is null and tg_op <> 'DELETE' then
    begin
      op_at := (to_jsonb(new)->>'updated_at')::timestamptz + interval '5 minutes';
    exception when others then
      op_at := null;
    end;
  end if;
  if op_at is not null and op_at < c then
    return null;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.enforce_account_sync_cutoff() from public, anon, authenticated;

-- "account_" sorts before the existing "set_updated_at" trigger, so the client's own updated_at is
-- read before that trigger replaces it.
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings','backlog_items','chapter_revisions','chapter_stages','chapters','daily_tasks','mistakes',
    'practice_sessions','profiles','pyq_records','study_cards','study_sessions','test_chapter_links',
    'test_error_logs','test_subject_scores','test_time_entries','tests','user_exam_tracks','weekly_goals'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists account_sync_cutoff on public.%I', t);
      execute format('create trigger account_sync_cutoff before insert or update or delete on public.%I for each row execute function public.enforce_account_sync_cutoff()', t);
    end if;
  end loop;
end $$;
