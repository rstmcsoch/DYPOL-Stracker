-- Additive, forward-only: extra exams a student adds in Settings ("Add exam").
-- Existing rows default to an empty list; no data is rewritten and RLS is unchanged
-- (app_settings keeps its owner-only policies).
alter table public.app_settings
  add column if not exists extra_exams jsonb not null default '[]'::jsonb;

alter table public.app_settings drop constraint if exists app_settings_extra_exams_shape;
alter table public.app_settings add constraint app_settings_extra_exams_shape
  check (jsonb_typeof(extra_exams) = 'array' and jsonb_array_length(extra_exams) <= 6 and pg_column_size(extra_exams) <= 4096);
