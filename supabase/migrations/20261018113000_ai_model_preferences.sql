-- Owner-editable ranked AI default-model lists (Phase 3).
-- Server-side only: RLS is enabled and FORCED, anon/authenticated have no grants, and all
-- reads/writes go through authenticated server routes (Control Center exams route for the
-- owner; the student's model-discovery route only returns the ranked result for their key).
-- Code tolerates this table being absent and falls back to the built-in ranked lists.
create table if not exists public.ai_model_preferences (
  id integer primary key check (id = 1),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) <= 16384),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.ai_model_preferences (id, preferences) values (1, '{}'::jsonb) on conflict (id) do nothing;

alter table public.ai_model_preferences enable row level security;
alter table public.ai_model_preferences force row level security;
revoke all on table public.ai_model_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_model_preferences to service_role;
