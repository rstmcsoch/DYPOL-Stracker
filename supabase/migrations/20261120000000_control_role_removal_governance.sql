-- Control Centre role-removal governance:
--   * Owner removal: requires explicit self-consent from the targeted owner, then starts a 30-day
--     IST (Asia/Kolkata) countdown with full Control Centre read-only lock. During those 30 days,
--     the targeted owner may submit an unstoppable 2-day restore review to reclaim full Owner access.
--   * Non-owner removal (administrator / moderator / viewer): requires unanimous approval from
--     every active unrestricted owner, then starts a 7-day IST countdown before final revocation.
-- Additive and forward-only. Strictly service-role only (no anon/authenticated grants).

create table if not exists public.control_role_removals (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  target_role text not null check (target_role = any (array['owner', 'administrator', 'moderator', 'viewer'])),
  status text not null check (status = any (array['pending_approval', 'countdown', 'review_restore', 'completed', 'restored', 'cancelled'])),
  initiated_by uuid references auth.users(id) on delete set null,
  initiated_at timestamptz not null default timezone('utc', now()),
  approved_by uuid[] not null default '{}'::uuid[],
  countdown_started_at timestamptz,
  effective_on_ist date,
  restore_requested_at timestamptz,
  restore_on_ist date,
  resolved_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.control_role_removals enable row level security;
alter table public.control_role_removals force row level security;
revoke all on public.control_role_removals from anon, authenticated;

-- At most one active removal/countdown/restore workflow per authority at a time.
create unique index if not exists control_role_removals_one_open_per_target
  on public.control_role_removals (target_user_id)
  where status = any (array['pending_approval', 'countdown', 'review_restore']);

create index if not exists control_role_removals_status_idx
  on public.control_role_removals (status, effective_on_ist, restore_on_ist);

create index if not exists control_role_removals_initiated_by_idx
  on public.control_role_removals (initiated_by);

-- Hardcore DB guard: once an owner enters the 2-day restore review (`review_restore`),
-- nobody can pause, cancel, delete, or step down the restore process. It may only transition
-- forward to `restored` once the 2-day IST target date is reached.
create or replace function public.control_guard_unstoppable_owner_restore()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today_ist date := (timezone('Asia/Kolkata', now()))::date;
begin
  if tg_op = 'DELETE' then
    if old.status = 'review_restore' then
      raise exception 'owner_restore_unstoppable' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status = 'review_restore' then
    if new.status <> 'restored' then
      raise exception 'owner_restore_unstoppable' using errcode = 'P0001';
    end if;
    if new.restore_on_ist is distinct from old.restore_on_ist then
      raise exception 'owner_restore_unstoppable' using errcode = 'P0001';
    end if;
    if old.restore_on_ist is not null and today_ist < old.restore_on_ist then
      raise exception 'owner_restore_not_due' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.control_guard_unstoppable_owner_restore() from public, anon, authenticated;

drop trigger if exists control_role_removals_protect_restore on public.control_role_removals;
create trigger control_role_removals_protect_restore
  before update or delete on public.control_role_removals
  for each row execute function public.control_guard_unstoppable_owner_restore();
