-- Fix: PL/pgSQL does not short-circuit "tg_table_name = ... and new.factor_type", so the
-- passkey table (which has no factor_type) raised for every insert. Check the table first.
create or replace function public.control_enforce_owner_only_passkeys()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'mfa_factors' then
    if new.factor_type::text <> 'webauthn' then
      return new;
    end if;
  end if;
  if exists (select 1 from public.control_roles where user_id = new.user_id and role = 'owner' and revoked_at is null) then
    return new;
  end if;
  raise exception 'passkeys_owner_only' using errcode = 'P0001';
end;
$$;
revoke all on function public.control_enforce_owner_only_passkeys() from public, anon, authenticated;
