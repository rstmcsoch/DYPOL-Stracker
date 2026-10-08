-- Stracker security hardening.
-- Keep private study tables unavailable to unauthenticated clients.
revoke all on table
  public.profiles,
  public.app_settings,
  public.chapters,
  public.chapter_revisions,
  public.tests,
  public.test_subject_scores,
  public.test_chapter_links,
  public.mistakes,
  public.daily_tasks,
  public.weekly_goals,
  public.study_sessions
from anon;

-- The Auth trigger is the intended caller of this function.
revoke execute on function public.handle_new_user() from public;

-- Harden the timestamp trigger against search_path manipulation.
alter function public.set_updated_at() set search_path = pg_catalog, public;

-- Future public-schema tables should not be exposed to anon by default.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

notify pgrst, 'reload schema';
