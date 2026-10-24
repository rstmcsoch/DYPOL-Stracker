-- Four-button card review (Again / Hard / Good / Easy).
-- Additive: a nullable column, so existing cards (and older clients that never
-- send it) keep working. difficulty stays as the coarse label the UI already shows.
alter table public.study_cards add column if not exists last_rating text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.study_cards'::regclass and conname = 'study_cards_last_rating_check'
  ) then
    alter table public.study_cards
      add constraint study_cards_last_rating_check
      check (last_rating is null or last_rating in ('again', 'hard', 'good', 'easy'));
  end if;
end $$;
