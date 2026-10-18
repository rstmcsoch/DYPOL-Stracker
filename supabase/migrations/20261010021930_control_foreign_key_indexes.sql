-- Index foreign-key columns used by Control Center records.
-- These indexes improve target-user lookups and referenced-user maintenance.
create index if not exists control_account_notes_target_user_id_idx
  on public.control_account_notes (target_user_id);

create index if not exists control_admin_sessions_user_id_idx
  on public.control_admin_sessions (user_id);
