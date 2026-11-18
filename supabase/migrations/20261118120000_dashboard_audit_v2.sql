-- Dashboard audit v2: three additive columns, no data rewrites.
--
-- 1. mistakes.cause           — the shared lost-mark vocabulary (the notebook used to keep a
--                              short type while mock analysis kept a longer category, so the
--                              same slip could never be added up).
-- 2. mistakes.retry_due_on    — spaced retry (+7 days, then +21) instead of "retry later"
--    mistakes.retry_count        meaning "someday"; count retires a note after two passes.
-- 3. tests.percentile         — the student's own percentile for a mock, when their coaching
--                              institute publishes one. Never derived, never estimated.
--
-- Backfill is deliberately conservative: existing notes keep a null cause and are read
-- through `causeOf()`, which maps `mistake_type`. Nothing is guessed on the server.

alter table public.mistakes
  add column if not exists cause text
    check (cause is null or cause in (
      'Silly mistake','Concept gap','Calculation error','Time pressure','Misread question','Guess / bad attempt','Unattempted'
    )),
  add column if not exists retry_due_on date,
  add column if not exists retry_count integer not null default 0
    check (retry_count between 0 and 99);

alter table public.tests
  add column if not exists percentile numeric(5, 2)
    check (percentile is null or (percentile >= 0 and percentile <= 100));

-- New notes created before a student opens the notebook still schedule honestly: the retry
-- queue falls back to created_at + 7 days when retry_due_on is null, so no backfill is needed.

-- Session notes: "what I actually did" on a focus block. The weekly report reads it, and it
-- is the only free text a focus session carries.
alter table public.study_sessions
  add column if not exists notes text not null default ''
    check (char_length(notes) <= 2000);

-- (study_sessions.activity already exists, added by 20261008180000_jee_prep_features.sql.)

-- The retry queue asks "what is due today or earlier", per owner.
create index if not exists mistakes_retry_due_idx
  on public.mistakes (user_id, retry_due_on)
  where retry_later and retry_status = 'pending';

comment on column public.mistakes.cause is 'Shared lost-mark cause; nullable, read through causeOf() which falls back to mistake_type.';
comment on column public.mistakes.retry_due_on is 'Next spaced retry (IST calendar date). Null = fall back to created_at + 7 days.';
comment on column public.mistakes.retry_count is 'Completed retries; 2 retires the note.';
comment on column public.tests.percentile is 'Student-entered percentile for this mock. Never derived.';
