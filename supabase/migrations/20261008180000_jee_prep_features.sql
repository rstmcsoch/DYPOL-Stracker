-- Stracker: JEE preparation features. Additive only — existing rows keep working.
-- Practice / DPP log, PYQ tracker, chapter stages, backlog, study-hours split,
-- mock deep-dive analysis, formula/flashcard decks, exam tracks, and settings extensions.

-- ---------------------------------------------------------------------------
-- Extend existing tables (additive columns with defaults; nothing is dropped).
-- ---------------------------------------------------------------------------

alter table public.study_sessions
  add column if not exists activity text not null default 'Practice'
  check (activity in ('Lecture','Practice','Revision','Mock/Test','PYQ practice'));

alter table public.chapters
  add column if not exists importance text not null default 'medium'
  check (importance in ('high','medium','low'));

alter table public.app_settings
  add column if not exists weight_high numeric(5,2) not null default 2 check (weight_high between 0.1 and 10),
  add column if not exists weight_medium numeric(5,2) not null default 1 check (weight_medium between 0.1 and 10),
  add column if not exists weight_low numeric(5,2) not null default 0.5 check (weight_low between 0.1 and 10),
  add column if not exists pyq_from_year integer not null default 2019 check (pyq_from_year between 1990 and 2100),
  add column if not exists pyq_to_year integer not null default 2026 check (pyq_to_year between 1990 and 2100),
  add column if not exists active_track text not null default 'main1'
  check (active_track in ('main1','main2','advanced','boards')),
  add column if not exists exam_mode text not null default 'auto'
  check (exam_mode in ('auto','on','off')),
  add column if not exists reminders_enabled boolean not null default false,
  add column if not exists reminder_time text not null default '08:00'
  check (reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column if not exists reminder_types text[] not null default array['revision','backlog']::text[];

-- ---------------------------------------------------------------------------
-- New tables. Every table is owner-scoped like the rest of the notebook.
-- ---------------------------------------------------------------------------

create table if not exists public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null,
  practice_date date not null,
  attempted integer not null check (attempted between 0 and 100000),
  correct integer not null check (correct between 0 and 100000),
  incorrect integer not null check (incorrect between 0 and 100000),
  source text not null default 'Other' check (source in ('DPP','Module','Practice sheet','Coaching material','Other')),
  time_minutes integer check (time_minutes is null or (time_minutes between 0 and 1440)),
  notes text not null default '' check (char_length(notes) <= 5000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, id),
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete cascade,
  constraint practice_counts_consistent check (correct + incorrect <= attempted)
);

create table if not exists public.pyq_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null,
  exam text not null check (exam in ('Main','Advanced')),
  year integer not null check (year between 1990 and 2100),
  status text not null default 'pending' check (status in ('done','pending')),
  questions_total integer check (questions_total is null or questions_total >= 0),
  questions_done integer check (questions_done is null or questions_done >= 0),
  meta jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, id),
  unique (chapter_id, exam, year),
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete cascade
);

create table if not exists public.chapter_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null,
  stage text not null check (stage in ('theory','notes','pyqs','revised','tested')),
  done boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, id),
  unique (chapter_id, stage),
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete cascade
);

create table if not exists public.backlog_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  type text not null default 'Topic' check (type in ('Lecture','DPP','Topic')),
  subject text check (subject is null or subject in ('Physics','Chemistry','Maths')),
  chapter_id uuid,
  priority text not null default 'Medium' check (priority in ('High','Medium','Low')),
  due_on date,
  status text not null default 'active' check (status in ('active','done','snoozed')),
  snoozed_until date,
  completed_at timestamptz,
  notes text not null default '' check (char_length(notes) <= 5000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, id),
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete set null
);

create table if not exists public.study_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null,
  kind text not null check (kind in ('formula','flashcard')),
  front text not null check (char_length(front) between 1 and 5000),
  back text not null check (char_length(back) between 1 and 10000),
  hint text not null default '' check (char_length(hint) <= 2000),
  position integer not null default 0 check (position >= 0),
  difficulty text check (difficulty is null or difficulty in ('easy','known','difficult')),
  reviews integer not null default 0 check (reviews >= 0),
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, id),
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete cascade
);

create table if not exists public.test_error_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  test_id uuid not null,
  chapter_id uuid,
  subject text check (subject is null or subject in ('Physics','Chemistry','Maths')),
  category text not null check (category in (
    'Silly mistake','Concept gap','Calculation error','Time pressure',
    'Misread question','Guess / bad attempt','Unattempted'
  )),
  marks_lost numeric(8,2) check (marks_lost is null or marks_lost >= 0),
  questions integer check (questions is null or questions >= 0),
  note text not null default '' check (char_length(note) <= 5000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, id),
  foreign key (user_id, test_id) references public.tests(user_id, id) on delete cascade,
  foreign key (user_id, chapter_id) references public.chapters(user_id, id) on delete set null
);

create table if not exists public.test_time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  test_id uuid not null,
  subject text check (subject is null or subject in ('Physics','Chemistry','Maths')),
  label text not null default '' check (char_length(label) <= 120),
  minutes integer check (minutes is null or (minutes between 0 and 1440)),
  attempted integer check (attempted is null or attempted >= 0),
  unattempted integer check (unattempted is null or unattempted >= 0),
  order_index integer not null default 0 check (order_index >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, id),
  foreign key (user_id, test_id) references public.tests(user_id, id) on delete cascade
);

create table if not exists public.user_exam_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track text not null check (track in ('main1','main2','advanced','boards')),
  label text not null default '' check (char_length(label) <= 120),
  exam_date date,
  enabled boolean not null default true,
  target_score numeric(8,2) check (target_score is null or target_score >= 0),
  notes text not null default '' check (char_length(notes) <= 5000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, id),
  unique (user_id, track)
);

-- Owner-only RLS + updated_at triggers for every new table.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'practice_sessions','pyq_records','chapter_stages','backlog_items',
    'study_cards','test_error_logs','test_time_entries','user_exam_tracks'
  ] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists "owner manages own rows" on public.%I', tbl);
    execute format('create policy "owner manages own rows" on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', tbl);
    execute format('drop trigger if exists set_updated_at on public.%I', tbl);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', tbl);
  end loop;
end $$;

create index if not exists practice_sessions_user_chapter_idx on public.practice_sessions(user_id, chapter_id, practice_date desc);
create index if not exists practice_sessions_user_date_idx on public.practice_sessions(user_id, practice_date desc);
create index if not exists pyq_records_user_chapter_idx on public.pyq_records(user_id, chapter_id, exam, year);
create index if not exists chapter_stages_user_chapter_idx on public.chapter_stages(user_id, chapter_id);
create index if not exists backlog_items_user_status_idx on public.backlog_items(user_id, status, due_on);
create index if not exists study_cards_user_chapter_idx on public.study_cards(user_id, chapter_id, kind);
create index if not exists study_cards_user_review_idx on public.study_cards(user_id, next_review_at);
create index if not exists test_error_logs_user_test_idx on public.test_error_logs(user_id, test_id);
create index if not exists test_time_entries_user_test_idx on public.test_time_entries(user_id, test_id, order_index);
create index if not exists user_exam_tracks_user_track_idx on public.user_exam_tracks(user_id, track);
