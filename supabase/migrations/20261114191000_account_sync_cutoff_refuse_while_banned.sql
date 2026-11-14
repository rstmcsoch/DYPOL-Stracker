-- Fix for 20261114180000: while a ban is active, the cutoff trigger skipped the write silently
-- (BEFORE triggers run before the row-level security check), so an open dashboard saw its sync
-- "succeed" and never learned it was banned. While banned the write is now refused with the
-- same insufficient_privilege error RLS would give, which makes the app show the ban popup and
-- sign out. After the ban, writes stamped before the cutoff are still skipped silently.
-- Additive and forward-only.
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
  if public.current_account_banned() then
    raise exception 'This account is banned.' using errcode = '42501';
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
