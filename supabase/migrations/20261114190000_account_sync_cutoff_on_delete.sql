-- Fix for 20261114180000: deleting an account that is banned right now cascades to account_bans,
-- and the cutoff trigger then tried to record a cutoff for a user that no longer exists (foreign
-- key violation), which blocked the deletion. Skip the cutoff when the user is gone.
-- Additive and forward-only.
create or replace function public.account_bans_sync_cutoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if (old.banned_until is null or old.banned_until > timezone('utc', now()))
      and exists (select 1 from auth.users u where u.id = old.user_id) then
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
