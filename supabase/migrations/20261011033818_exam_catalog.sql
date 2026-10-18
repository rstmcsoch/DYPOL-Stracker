-- Exam catalogue + each student's exam selection.
--
-- Safety model:
--   * public.exam_catalog: RLS enabled and FORCED. anon/authenticated may only SELECT rows
--     that are not hidden. Writes go only through the Control Center API (service role,
--     owner with aal2, audited). Removing an exam = hidden = true (soft delete), so a
--     student who already chose it keeps working.
--   * app_settings gets nullable/defaulted exam columns. NULL exam_id means the student was
--     set up before this feature, which the app reads as JEE — existing data is untouched.
--   * No foreign key from app_settings.exam_id to the catalogue, so hiding/removing an exam
--     can never fail or cascade into student rows.

create table if not exists public.exam_catalog (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  category text not null check (char_length(category) between 1 and 40),
  years integer[] not null default '{}' check (cardinality(years) <= 12 and 2020 <= all(years) and 2100 >= all(years)),
  sessions text[] not null default '{}' check (cardinality(sessions) <= 24),
  boards text[] not null default '{}' check (cardinality(boards) <= 24),
  boards_addon boolean not null default false,
  sort_order integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

create index if not exists exam_catalog_updated_by_idx on public.exam_catalog (updated_by);

alter table public.exam_catalog enable row level security;
alter table public.exam_catalog force row level security;
revoke all on table public.exam_catalog from public, anon, authenticated;
grant select on table public.exam_catalog to anon, authenticated;
grant select, insert, update, delete on table public.exam_catalog to service_role;

drop policy if exists exam_catalog_read_visible on public.exam_catalog;
create policy exam_catalog_read_visible on public.exam_catalog
  for select to anon, authenticated
  using (hidden = false);

insert into public.exam_catalog (id, name, category, sessions, boards, boards_addon, sort_order) values
  ('jee', 'JEE (Main + Advanced)', 'Engineering', '{}'::text[], '{}'::text[], true, 10),
  ('mht-cet', 'MHT CET', 'Engineering', '{}'::text[], '{}'::text[], true, 20),
  ('bitsat', 'BITSAT', 'Engineering', '{}'::text[], '{}'::text[], true, 30),
  ('viteee', 'VITEEE', 'Engineering', '{}'::text[], '{}'::text[], true, 40),
  ('comedk-uget', 'COMEDK UGET', 'Engineering', '{}'::text[], '{}'::text[], true, 50),
  ('wbjee', 'WBJEE', 'Engineering', '{}'::text[], '{}'::text[], true, 60),
  ('kcet', 'KCET', 'Engineering', '{}'::text[], '{}'::text[], true, 70),
  ('neet-ug', 'NEET UG', 'Medical', '{}'::text[], '{}'::text[], true, 80),
  ('cuet-ug', 'CUET UG', 'University admission', '{}'::text[], '{}'::text[], true, 90),
  ('clat', 'CLAT', 'Law', '{}'::text[], '{}'::text[], true, 100),
  ('nda', 'NDA & NA', 'Defence', array['NDA I', 'NDA II']::text[], '{}'::text[], true, 110),
  ('class-9', 'Class 9', 'School', '{}'::text[], array['CBSE', 'ICSE / ISC', 'State board', 'Other board']::text[], false, 120),
  ('class-10', 'Class 10', 'School', '{}'::text[], array['CBSE', 'ICSE / ISC', 'State board', 'Other board']::text[], false, 130),
  ('class-11', 'Class 11', 'School', '{}'::text[], array['CBSE', 'ICSE / ISC', 'State board', 'Other board']::text[], false, 140),
  ('class-12', 'Class 12', 'School', '{}'::text[], array['CBSE', 'ICSE / ISC', 'State board', 'Other board']::text[], false, 150),
  ('ca-foundation', 'CA Foundation', 'Commerce & professional', array['January', 'May', 'September']::text[], '{}'::text[], false, 160),
  ('ca-intermediate', 'CA Intermediate', 'Commerce & professional', array['January', 'May', 'September']::text[], '{}'::text[], false, 170),
  ('ca-final', 'CA Final', 'Commerce & professional', array['May', 'November']::text[], '{}'::text[], false, 180),
  ('cs-executive', 'CS Executive', 'Commerce & professional', array['June', 'December']::text[], '{}'::text[], false, 190),
  ('cs-professional', 'CS Professional', 'Commerce & professional', array['June', 'December']::text[], '{}'::text[], false, 200),
  ('cma-intermediate', 'CMA Intermediate', 'Commerce & professional', array['June', 'December']::text[], '{}'::text[], false, 210),
  ('cma-final', 'CMA Final', 'Commerce & professional', array['June', 'December']::text[], '{}'::text[], false, 220),
  ('gate', 'GATE', 'Postgraduate', '{}'::text[], '{}'::text[], false, 230),
  ('cat', 'CAT', 'Postgraduate', '{}'::text[], '{}'::text[], false, 240),
  ('upsc-cse', 'UPSC Civil Services', 'Government jobs', '{}'::text[], '{}'::text[], false, 250),
  ('ssc-cgl', 'SSC CGL', 'Government jobs', '{}'::text[], '{}'::text[], false, 260),
  ('ibps-po', 'IBPS PO', 'Banking', '{}'::text[], '{}'::text[], false, 270),
  ('sbi-po', 'SBI PO', 'Banking', '{}'::text[], '{}'::text[], false, 280)
on conflict (id) do nothing;

alter table public.app_settings
  add column if not exists exam_id text check (exam_id is null or exam_id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  add column if not exists exam_year integer check (exam_year is null or exam_year between 2020 and 2100),
  add column if not exists exam_session text check (exam_session is null or char_length(exam_session) <= 40),
  add column if not exists exam_board text check (exam_board is null or char_length(exam_board) <= 40),
  add column if not exists boards_addon boolean not null default false;
