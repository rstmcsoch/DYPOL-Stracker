-- Reverses supabase/migrations/20261009210000_control_center_admin.sql.
-- Run manually, only after confirming that no admin audit record must be kept.
-- The append-only audit trigger is removed first, so the audit table can be dropped.
-- Dropping admin_audit_events destroys the audit trail. Export it before running this.

drop function if exists public.admin_list_users(text, text, text, integer, integer);
drop function if exists public.admin_registration_series(timestamptz, timestamptz);
drop function if exists public.admin_overview_metrics(timestamptz, timestamptz);
drop function if exists public.admin_take_rate_slot(text, integer, integer);
drop table if exists public.admin_rate_events;
drop trigger if exists admin_audit_no_truncate on public.admin_audit_events;
drop trigger if exists admin_audit_no_update_delete on public.admin_audit_events;
drop function if exists public.admin_audit_block_mutation();
drop table if exists public.admin_audit_events;
drop table if exists public.admin_roles;

notify pgrst, 'reload schema';
