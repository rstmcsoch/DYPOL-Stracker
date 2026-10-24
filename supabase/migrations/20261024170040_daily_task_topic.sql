-- Optional topic / subtopic on planner tasks. Additive and nullable: existing rows and
-- older clients that never send it keep working.
alter table public.daily_tasks add column if not exists topic text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.daily_tasks'::regclass and conname = 'daily_tasks_topic_check'
  ) then
    alter table public.daily_tasks
      add constraint daily_tasks_topic_check check (topic is null or char_length(topic) <= 120);
  end if;
end $$;
