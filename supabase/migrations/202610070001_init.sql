-- Stracker: single-owner study notebook schema. Run with Supabase CLI or SQL Editor.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = timezone('utc', now()); return new; end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  email text not null default '' check (char_length(email) <= 320),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_own_id check (id = user_id)
);

create table if not exists public.app_settings (
  id uuid primary key references auth.users(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  owner_name text not null default '' check (char_length(owner_name) <= 100),
  main_exam_date date,
  advanced_exam_date date,
  target_score numeric(8,2) not null default 240 check (target_score >= 0),
  theme text not null default 'light' check (theme in ('light','dark','auto')),
  weak_threshold numeric(5,2) not null default 60 check (weak_threshold between 0 and 100),
  strong_threshold numeric(5,2) not null default 80 check (strong_threshold between 0 and 100),
  dropping_threshold numeric(5,2) not null default 10 check (dropping_threshold between 0 and 100),
  revision_gaps integer[] not null default array[1,7,30] check (cardinality(revision_gaps) between 1 and 12),
  daily_study_goal_minutes integer not null default 360 check (daily_study_goal_minutes >= 0),
  last_backup_at timestamptz,
  sound_enabled boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint app_settings_own_id check (id = user_id),
  constraint settings_threshold_order check (weak_threshold < strong_threshold)
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (subject in ('Physics','Chemistry','Maths')),
  name text not null check (char_length(name) between 1 and 140),
  position integer not null default 0 check (position >= 0),
  status text not null default 'Not Started' check (status in ('Not Started','Studying','Done','Revised')),
  priority text not null default 'Medium' check (priority in ('High','Medium','Low')),
  weightage text check (weightage is null or char_length(weightage) <= 80),
  notes text not null default '' check (char_length(notes) <= 20000),
  formula_notes text not null default '' check (char_length(formula_notes) <= 20000),
  completed_on date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, subject, name),
  unique (user_id, id)
);

create table if not exists public.chapter_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  due_on date not null,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete cascade,
  unique (chapter_id, revision_number)
);

create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  test_date date not null,
  test_type text not null check (test_type in ('Chapter Test','Subject Test','Full Mock','PYQ Practice')),
  subject text check (subject is null or subject in ('Physics','Chemistry','Maths')),
  chapter_id uuid,
  marks_obtained numeric(9,2) check (marks_obtained is null or marks_obtained >= 0),
  total_marks numeric(9,2) check (total_marks is null or total_marks > 0),
  correct integer check (correct is null or correct >= 0),
  wrong integer check (wrong is null or wrong >= 0),
  skipped integer check (skipped is null or skipped >= 0),
  negative_marks numeric(8,2) check (negative_marks is null or negative_marks >= 0),
  time_minutes integer check (time_minutes is null or time_minutes >= 0),
  notes text not null default '' check (char_length(notes) <= 10000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, id),
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete set null (chapter_id),
  constraint tests_valid_marks check (marks_obtained is null or total_marks is null or marks_obtained <= total_marks * 2)
);

create table if not exists public.test_subject_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  test_id uuid not null,
  subject text not null check (subject in ('Physics','Chemistry','Maths')),
  marks_obtained numeric(9,2) check (marks_obtained is null or marks_obtained >= 0),
  total_marks numeric(9,2) check (total_marks is null or total_marks > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (user_id, test_id) references public.tests(user_id, id) on delete cascade,
  unique (test_id, subject)
);

create table if not exists public.test_chapter_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  test_id uuid not null,
  chapter_id uuid not null,
  marks_obtained numeric(9,2) check (marks_obtained is null or marks_obtained >= 0),
  total_marks numeric(9,2) check (total_marks is null or total_marks > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (user_id, test_id) references public.tests(user_id, id) on delete cascade,
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete cascade,
  unique (test_id, chapter_id)
);

create table if not exists public.mistakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null,
  test_id uuid,
  mistake_type text not null check (mistake_type in ('Concept','Silly','Calculation','Time','Guess')),
  question_note text not null check (char_length(question_note) between 1 and 10000),
  solution_note text not null default '' check (char_length(solution_note) <= 10000),
  image_path text check (image_path is null or char_length(image_path) <= 500),
  retry_later boolean not null default false,
  retry_status text not null default 'pending' check (retry_status in ('pending','retried')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete cascade,
  foreign key (user_id, test_id) references public.tests(user_id, id) on delete set null (test_id)
);

create table if not exists public.daily_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  subject text check (subject is null or subject in ('Physics','Chemistry','Maths')),
  chapter_id uuid,
  estimated_minutes integer not null default 30 check (estimated_minutes between 0 and 1440),
  priority text not null default 'Medium' check (priority in ('High','Medium','Low')),
  is_completed boolean not null default false,
  task_date date not null,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete set null
);

create table if not exists public.weekly_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_type text not null check (goal_type in ('study_hours','tests','chapters','revisions','custom')),
  title text not null check (char_length(title) between 1 and 120),
  target numeric(8,2) not null check (target > 0),
  progress_value numeric(8,2) not null default 0 check (progress_value >= 0),
  week_start date not null,
  unit text not null default '' check (char_length(unit) <= 30),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text check (subject is null or subject in ('Physics','Chemistry','Maths')),
  chapter_id uuid,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_minutes integer not null default 0 check (duration_minutes between 0 and 1440),
  completion_state text not null default 'completed' check (completion_state in ('completed','interrupted')),
  mode text not null default 'Pomodoro' check (mode in ('Pomodoro','Short Break','Long Break','Custom')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete set null
);

-- Every private table has RLS enabled. Policies are tied to the signed-in UUID,
-- never to an email or a hard-coded owner identifier in frontend code.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'profiles','app_settings','chapters','chapter_revisions','tests','test_subject_scores',
    'test_chapter_links','mistakes','daily_tasks','weekly_goals','study_sessions'
  ] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists "owner manages own rows" on public.%I', tbl);
    execute format('create policy "owner manages own rows" on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', tbl);
    execute format('drop trigger if exists set_updated_at on public.%I', tbl);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', tbl);
  end loop;
end $$;

create index if not exists chapters_user_subject_position_idx on public.chapters(user_id, subject, position);
create index if not exists revisions_user_due_idx on public.chapter_revisions(user_id, due_on) where completed_at is null;
create index if not exists tests_user_date_idx on public.tests(user_id, test_date desc);
create index if not exists test_scores_user_subject_idx on public.test_subject_scores(user_id, subject, test_id);
create index if not exists test_links_user_chapter_idx on public.test_chapter_links(user_id, chapter_id, test_id);
create index if not exists mistakes_user_chapter_idx on public.mistakes(user_id, chapter_id, created_at desc);
create index if not exists tasks_user_date_idx on public.daily_tasks(user_id, task_date, position);
create index if not exists sessions_user_started_idx on public.study_sessions(user_id, started_at desc);
create index if not exists goals_user_week_idx on public.weekly_goals(user_id, week_start);

-- A private image bucket. Storage policies enforce the owner UUID as the first path segment.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mistake-images', 'mistake-images', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "owner manages own mistake images" on storage.objects;
create policy "owner manages own mistake images" on storage.objects
for all to authenticated
using (bucket_id = 'mistake-images' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'mistake-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- Create a profile row from trusted auth metadata. Owner setup itself is performed
-- in Supabase Dashboard after disabling public signups; there is intentionally no sign-up endpoint here.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, user_id, display_name, email)
  values (new.id, new.id, coalesce(new.raw_user_meta_data ->> 'display_name',''), coalesce(new.email,''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();
