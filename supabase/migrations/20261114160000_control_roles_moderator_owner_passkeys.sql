-- Control Centre: final role set (Owner, Admin, Moderator, Viewer) and owner-only passkeys.
-- Forward-only. Existing rows are migrated in place; no student data is touched.

-- 1. Roles. manager -> moderator; support and analyst -> viewer. The Support role is retired.
alter table public.control_roles drop constraint if exists control_roles_role_check;
alter table public.control_role_permissions drop constraint if exists control_role_permissions_role_check;

update public.control_roles set role = 'viewer' where role in ('support', 'analyst');
update public.control_roles set role = 'moderator' where role = 'manager';

delete from public.control_role_permissions where role = 'support';
update public.control_role_permissions set role = 'viewer' where role = 'analyst';
update public.control_role_permissions set role = 'moderator' where role = 'manager';

-- Moderator also inherits the retired Support role's inbox and account lookup rights.
insert into public.control_role_permissions (role, permission, allowed)
select 'moderator', p, true from unnest(array['overview.view','messages.view','messages.manage','users.view']) as p
on conflict (role, permission) do nothing;

alter table public.control_roles add constraint control_roles_role_check
  check (role = any (array['owner','administrator','moderator','viewer']));
alter table public.control_role_permissions add constraint control_role_permissions_role_check
  check (role = any (array['administrator','moderator','viewer']));

-- 2. Passkeys are the owner's alone. Supabase Auth would let any signed-in account register a
--    passkey (first-factor credential) or a WebAuthn MFA factor; these triggers refuse both for
--    every account that is not the active owner, whatever client or API is used.
create or replace function public.control_enforce_owner_only_passkeys()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'mfa_factors' and new.factor_type::text <> 'webauthn' then
    return new;
  end if;
  if exists (select 1 from public.control_roles where user_id = new.user_id and role = 'owner' and revoked_at is null) then
    return new;
  end if;
  raise exception 'passkeys_owner_only' using errcode = 'P0001';
end;
$$;
revoke all on function public.control_enforce_owner_only_passkeys() from public, anon, authenticated;

drop trigger if exists control_owner_only_passkeys on auth.webauthn_credentials;
create trigger control_owner_only_passkeys before insert on auth.webauthn_credentials
  for each row execute function public.control_enforce_owner_only_passkeys();

drop trigger if exists control_owner_only_webauthn_factors on auth.mfa_factors;
create trigger control_owner_only_webauthn_factors before insert on auth.mfa_factors
  for each row execute function public.control_enforce_owner_only_passkeys();
