-- Practice blocks: questions skipped, recorded separately from attempted/correct/incorrect.
-- Additive: existing rows get 0 through the column default; nothing is rewritten or deleted.
alter table public.practice_sessions add column if not exists skipped integer not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'practice_sessions_skipped_check' and conrelid = 'public.practice_sessions'::regclass) then
    alter table public.practice_sessions add constraint practice_sessions_skipped_check check (skipped >= 0 and skipped <= 100000);
  end if;
end $$;
