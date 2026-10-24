-- Optional total question count for a test, so correct + wrong + skipped can be checked.
-- Additive and nullable: existing rows stay NULL and keep passing.
alter table public.tests add column if not exists total_questions integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tests_total_questions_check' and conrelid = 'public.tests'::regclass) then
    alter table public.tests add constraint tests_total_questions_check
      check (total_questions is null or (total_questions > 0 and total_questions <= 100000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tests_counts_within_total_questions' and conrelid = 'public.tests'::regclass) then
    alter table public.tests add constraint tests_counts_within_total_questions
      check (total_questions is null or coalesce(correct, 0) + coalesce(wrong, 0) + coalesce(skipped, 0) <= total_questions);
  end if;
end $$;
