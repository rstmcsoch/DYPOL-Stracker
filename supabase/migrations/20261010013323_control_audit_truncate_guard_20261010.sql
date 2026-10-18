-- Defense in depth for the existing Stracker Control Center audit trail.
-- Row-level UPDATE/DELETE triggers do not block TRUNCATE. Restrict that privilege
-- and add a statement trigger so an accidental privileged TRUNCATE is rejected.
--
-- This repository currently does not contain the historical control_center migration
-- that created this table. The guard is therefore conditional for fresh databases where
-- that legacy control schema is absent; it applies to the existing database where present.

do $migration$
begin
  if to_regclass('public.control_audit_events') is not null
     and to_regprocedure('public.control_audit_immutable()') is not null then
    execute 'revoke truncate on table public.control_audit_events from public, anon, authenticated, service_role';

    if not exists (
      select 1
      from pg_catalog.pg_trigger
      where tgrelid = 'public.control_audit_events'::regclass
        and tgname = 'control_audit_no_truncate'
        and not tgisinternal
    ) then
      execute 'create trigger control_audit_no_truncate
        before truncate on public.control_audit_events
        for each statement
        execute function public.control_audit_immutable()';
    end if;
  end if;
end;
$migration$;
