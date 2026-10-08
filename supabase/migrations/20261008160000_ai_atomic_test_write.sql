-- A narrowly-scoped application RPC for the Full Mock flow. It derives the owner
-- from the authenticated JWT, runs as the invoker so tests/test-score RLS applies,
-- writes the parent and its optional subject scores in one transaction, and exposes
-- no dynamic SQL or arbitrary table/column selection.
create or replace function public.ai_create_test_with_scores(test_payload jsonb, score_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  owner_id uuid := auth.uid();
  test_id uuid;
  test_row public.tests%rowtype;
  score_item jsonb;
  saved_scores jsonb := '[]'::jsonb;
  item_id uuid;
  item_subject text;
  item_marks numeric;
  item_total numeric;
  score_count integer := 0;
  complete_score_count integer := 0;
  score_marks_sum numeric := 0;
  score_total_sum numeric := 0;
  parent_marks numeric;
  parent_total numeric;
  test_type_value text;
  subject_value text;
  chapter_id_value uuid;
  chapter_subject text;
  score_row public.test_subject_scores%rowtype;
begin
  if owner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(test_payload) is distinct from 'object'
     or jsonb_typeof(coalesce(score_payload, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'invalid test payload' using errcode = '22023';
  end if;

  test_id := coalesce(nullif(test_payload->>'id','')::uuid,gen_random_uuid());
  test_type_value := test_payload->>'test_type';
  parent_marks := nullif(test_payload->>'marks_obtained','')::numeric;
  parent_total := nullif(test_payload->>'total_marks','')::numeric;

  if length(btrim(coalesce(test_payload->>'title',''))) not between 1 and 160
     or test_type_value is null or test_type_value not in ('Chapter Test','Subject Test','Full Mock','PYQ Practice')
     or coalesce(test_payload->>'test_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'invalid test fields' using errcode = '22023';
  end if;
  if (parent_marks is not null and (parent_marks < 0 or parent_marks > 9999999.5 or parent_marks * 2 <> trunc(parent_marks * 2)))
     or (parent_total is not null and (parent_total <= 0 or parent_total > 9999999 or parent_total <> trunc(parent_total)))
     or (parent_marks is not null and (parent_total is null or parent_marks > parent_total)) then
    raise exception 'invalid aggregate test score' using errcode = '22023';
  end if;
  if test_type_value <> 'Full Mock' and jsonb_array_length(coalesce(score_payload,'[]'::jsonb)) > 0 then
    raise exception 'subject scores are only valid for a Full Mock' using errcode = '22023';
  end if;

  chapter_id_value := nullif(test_payload->>'chapter_id','')::uuid;
  subject_value := nullif(test_payload->>'subject','');
  if subject_value is not null and subject_value not in ('Physics','Chemistry','Maths') then
    raise exception 'invalid test subject' using errcode = '22023';
  end if;
  if chapter_id_value is not null then
    select subject into chapter_subject from public.chapters where id=chapter_id_value and user_id=owner_id;
    if not found then
      raise exception 'chapter not found' using errcode = 'P0002';
    end if;
    if subject_value is not null and subject_value <> chapter_subject then
      raise exception 'test chapter does not belong to its subject' using errcode = '22023';
    end if;
    subject_value := chapter_subject;
  end if;

  insert into public.tests (
    id,user_id,title,test_date,test_type,subject,chapter_id,marks_obtained,total_marks,
    correct,wrong,skipped,negative_marks,time_minutes,notes,created_at,updated_at
  ) values (
    test_id,owner_id,btrim(test_payload->>'title'),(test_payload->>'test_date')::date,test_type_value,
    subject_value,chapter_id_value,
    parent_marks,parent_total,
    nullif(test_payload->>'correct','')::integer,nullif(test_payload->>'wrong','')::integer,
    nullif(test_payload->>'skipped','')::integer,nullif(test_payload->>'negative_marks','')::numeric,
    nullif(test_payload->>'time_minutes','')::integer,coalesce(test_payload->>'notes',''),
    now(),now()
  );

  if chapter_id_value is not null then
    insert into public.test_chapter_links(user_id,test_id,chapter_id,marks_obtained,total_marks)
      values (owner_id,test_id,chapter_id_value,parent_marks,parent_total);
  end if;

  for score_item in select value from jsonb_array_elements(coalesce(score_payload,'[]'::jsonb))
  loop
    score_count := score_count + 1;
    item_id := nullif(score_item->>'id','')::uuid;
    item_subject := score_item->>'subject';
    item_marks := nullif(score_item->>'marks_obtained','')::numeric;
    item_total := nullif(score_item->>'total_marks','')::numeric;
    if item_id is null
       or item_subject is null or item_subject not in ('Physics','Chemistry','Maths')
       or (item_marks is null and item_total is null)
       or (item_total is not null and (item_total <= 0 or item_total > 9999999 or item_total <> trunc(item_total)))
       or (item_marks is not null and (item_marks < 0 or item_marks > 9999999.5 or item_marks * 2 <> trunc(item_marks * 2)))
       or (item_marks is not null and (item_total is null or item_marks > item_total)) then
      raise exception 'invalid subject score' using errcode = '22023';
    end if;

    insert into public.test_subject_scores (id,user_id,test_id,subject,marks_obtained,total_marks)
    values (item_id,owner_id,test_id,item_subject,item_marks,item_total)
    returning * into score_row;
    saved_scores := saved_scores || jsonb_build_array(to_jsonb(score_row));
    if item_marks is not null and item_total is not null then
      complete_score_count := complete_score_count + 1;
      score_marks_sum := score_marks_sum + item_marks;
      score_total_sum := score_total_sum + item_total;
    end if;
  end loop;

  if score_count > 3 then
    raise exception 'a Full Mock can contain at most three subject scores' using errcode = '22023';
  end if;
  if test_type_value = 'Full Mock' then
    if complete_score_count = 3 then
      if parent_marks is distinct from score_marks_sum or parent_total is distinct from score_total_sum then
        raise exception 'aggregate marks must match all three subject scores' using errcode = '22023';
      end if;
    elsif parent_marks is not null or parent_total is not null then
      raise exception 'aggregate marks require complete scores for all three subjects' using errcode = '22023';
    end if;
  end if;

  select * into test_row from public.tests where id = test_id and user_id = owner_id;
  if not found then
    raise exception 'test write was not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object('test',to_jsonb(test_row),'subject_scores',saved_scores);
end;
$$;

revoke all on function public.ai_create_test_with_scores(jsonb,jsonb) from public,anon;
grant execute on function public.ai_create_test_with_scores(jsonb,jsonb) to authenticated;

-- Match Stracker's test editor: update the row and its single chapter-score link
-- atomically, after checking the server snapshot and chapter ownership.
create or replace function public.ai_update_test_record(test_payload jsonb,expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog,public
as $$
declare
  owner_id uuid := auth.uid();
  target_test_id uuid;
  test_row public.tests%rowtype;
  link_row public.test_chapter_links%rowtype;
  existing_link public.test_chapter_links%rowtype;
  title_value text;
  date_value date;
  type_value text;
  subject_value text;
  chapter_id_value uuid;
  chapter_subject text;
  marks_value numeric;
  total_value numeric;
  correct_value numeric;
  wrong_value numeric;
  skipped_value numeric;
  negative_value numeric;
  time_value numeric;
  notes_value text;
begin
  if owner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if expected_updated_at is null or jsonb_typeof(test_payload) is distinct from 'object' then
    raise exception 'invalid test update' using errcode = '22023';
  end if;
  target_test_id := nullif(test_payload->>'id','')::uuid;
  if target_test_id is null then
    raise exception 'test ID is required' using errcode = '22023';
  end if;
  select * into test_row from public.tests where id=target_test_id and user_id=owner_id for update;
  if not found then
    raise exception 'test not found' using errcode = 'P0002';
  end if;
  if test_row.updated_at is distinct from expected_updated_at then
    raise exception 'test changed after the action was prepared' using errcode = '40001';
  end if;

  title_value := btrim(coalesce(test_payload->>'title',''));
  type_value := test_payload->>'test_type';
  subject_value := nullif(test_payload->>'subject','');
  chapter_id_value := nullif(test_payload->>'chapter_id','')::uuid;
  marks_value := nullif(test_payload->>'marks_obtained','')::numeric;
  total_value := nullif(test_payload->>'total_marks','')::numeric;
  correct_value := nullif(test_payload->>'correct','')::numeric;
  wrong_value := nullif(test_payload->>'wrong','')::numeric;
  skipped_value := nullif(test_payload->>'skipped','')::numeric;
  negative_value := nullif(test_payload->>'negative_marks','')::numeric;
  time_value := nullif(test_payload->>'time_minutes','')::numeric;
  notes_value := coalesce(test_payload->>'notes','');
  if length(title_value) not between 1 and 160
     or coalesce(test_payload->>'test_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or type_value is null or type_value not in ('Chapter Test','Subject Test','Full Mock','PYQ Practice')
     or (subject_value is not null and subject_value not in ('Physics','Chemistry','Maths'))
     or char_length(notes_value) > 10000 then
    raise exception 'invalid test fields' using errcode = '22023';
  end if;
  date_value := (test_payload->>'test_date')::date;
  if (marks_value is not null and (marks_value < 0 or marks_value > 9999999.5 or marks_value*2 <> trunc(marks_value*2)))
     or (total_value is not null and (total_value <= 0 or total_value > 9999999 or total_value <> trunc(total_value)))
     or (marks_value is not null and (total_value is null or marks_value > total_value))
     or (correct_value is not null and (correct_value < 0 or correct_value > 2147483647 or correct_value <> trunc(correct_value)))
     or (wrong_value is not null and (wrong_value < 0 or wrong_value > 2147483647 or wrong_value <> trunc(wrong_value)))
     or (skipped_value is not null and (skipped_value < 0 or skipped_value > 2147483647 or skipped_value <> trunc(skipped_value)))
     or (negative_value is not null and (negative_value < 0 or negative_value > 999999.75 or negative_value*4 <> trunc(negative_value*4)))
     or (time_value is not null and (time_value < 0 or time_value > 2147483647 or time_value <> trunc(time_value))) then
    raise exception 'invalid test score or timing values' using errcode = '22023';
  end if;
  if (test_row.test_type='Full Mock' and type_value <> 'Full Mock')
     or (test_row.test_type<>'Full Mock' and type_value='Full Mock') then
    raise exception 'Full Mock type changes require an explicit subject-score rebuild' using errcode = '22023';
  end if;
  if test_row.test_type='Full Mock'
     and (marks_value is distinct from test_row.marks_obtained or total_value is distinct from test_row.total_marks) then
    raise exception 'Full Mock aggregate scores must be updated through subject scores' using errcode = '22023';
  end if;

  if chapter_id_value is not null then
    select subject into chapter_subject from public.chapters where id=chapter_id_value and user_id=owner_id;
    if not found then
      raise exception 'chapter not found' using errcode = 'P0002';
    end if;
    if subject_value is not null and subject_value <> chapter_subject then
      raise exception 'test chapter does not belong to its subject' using errcode = '22023';
    end if;
    subject_value := chapter_subject;
  end if;

  update public.tests set
    title=title_value,test_date=date_value,test_type=type_value,subject=subject_value,chapter_id=chapter_id_value,
    marks_obtained=marks_value,total_marks=total_value,correct=correct_value::integer,wrong=wrong_value::integer,
    skipped=skipped_value::integer,negative_marks=negative_value,time_minutes=time_value::integer,notes=notes_value,updated_at=now()
    where id=target_test_id and user_id=owner_id returning * into test_row;

  select * into existing_link from public.test_chapter_links
    where user_id=owner_id and test_id=target_test_id and chapter_id=chapter_id_value;
  delete from public.test_chapter_links where user_id=owner_id and test_id=target_test_id;
  if chapter_id_value is not null then
    insert into public.test_chapter_links(id,user_id,test_id,chapter_id,marks_obtained,total_marks,created_at,updated_at)
      values (coalesce(existing_link.id,gen_random_uuid()),owner_id,target_test_id,chapter_id_value,marks_value,total_value,
              coalesce(existing_link.created_at,now()),now())
      on conflict (test_id,chapter_id) do update
        set marks_obtained=excluded.marks_obtained,total_marks=excluded.total_marks,updated_at=now()
      returning * into link_row;
  end if;

  return jsonb_build_object('test',to_jsonb(test_row),'chapter_link',case when link_row.id is null then null else to_jsonb(link_row) end);
end;
$$;

revoke all on function public.ai_update_test_record(jsonb,timestamptz) from public,anon;
grant execute on function public.ai_update_test_record(jsonb,timestamptz) to authenticated;

-- Keep a single Full Mock subject-score change and its derived aggregate atomic.
create or replace function public.ai_update_test_subject_score(
  target_test_id uuid,expected_updated_at timestamptz,subject_value text,marks_value numeric,total_value numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog,public
as $$
declare
  owner_id uuid := auth.uid();
  test_row public.tests%rowtype;
  score_row public.test_subject_scores%rowtype;
  link_row public.test_chapter_links%rowtype;
  existing_link public.test_chapter_links%rowtype;
  previous_score_count integer := 0;
  complete_score_count integer := 0;
  aggregate_marks numeric;
  aggregate_total numeric;
begin
  if owner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if expected_updated_at is null or subject_value not in ('Physics','Chemistry','Maths')
     or total_value is null or total_value <= 0 or total_value > 9999999 or total_value <> trunc(total_value)
     or (marks_value is not null and (marks_value < 0 or marks_value > 9999999.5 or marks_value * 2 <> trunc(marks_value * 2) or marks_value > total_value)) then
    raise exception 'invalid subject score' using errcode = '22023';
  end if;

  select * into test_row from public.tests where id = target_test_id and user_id = owner_id for update;
  if not found then
    raise exception 'test not found' using errcode = 'P0002';
  end if;
  if test_row.test_type <> 'Full Mock' then
    raise exception 'subject score updates require a Full Mock' using errcode = '22023';
  end if;
  if test_row.updated_at is distinct from expected_updated_at then
    raise exception 'Full Mock changed after the action was prepared' using errcode = '40001';
  end if;

  select count(*) into previous_score_count from public.test_subject_scores where user_id = owner_id and test_subject_scores.test_id = ai_update_test_subject_score.target_test_id;
  insert into public.test_subject_scores(user_id,test_id,subject,marks_obtained,total_marks)
  values (owner_id,target_test_id,subject_value,marks_value,total_value)
  on conflict (test_id,subject) do update set marks_obtained=excluded.marks_obtained,total_marks=excluded.total_marks,updated_at=now()
  returning * into score_row;

  select count(*) filter (where marks_obtained is not null and total_marks is not null),
         coalesce(sum(marks_obtained) filter (where marks_obtained is not null and total_marks is not null),0),
         coalesce(sum(total_marks) filter (where marks_obtained is not null and total_marks is not null),0)
    into complete_score_count,aggregate_marks,aggregate_total
    from public.test_subject_scores
    where user_id=owner_id and test_subject_scores.test_id=ai_update_test_subject_score.target_test_id;

  if complete_score_count = 3 then
    if aggregate_marks > 9999999.5 or aggregate_total > 9999999 or aggregate_marks > aggregate_total then
      raise exception 'combined Full Mock score exceeds Stracker limits' using errcode = '22023';
    end if;
    update public.tests set marks_obtained=aggregate_marks,total_marks=aggregate_total,updated_at=now()
      where id=target_test_id and user_id=owner_id returning * into test_row;
  elsif previous_score_count > 0 or test_row.marks_obtained is null or test_row.total_marks is null then
    update public.tests set marks_obtained=null,total_marks=null,updated_at=now()
      where id=target_test_id and user_id=owner_id returning * into test_row;
  end if;

  select * into existing_link from public.test_chapter_links
    where user_id=owner_id and test_id=target_test_id and chapter_id=test_row.chapter_id;
  delete from public.test_chapter_links where user_id=owner_id and test_id=target_test_id;
  if test_row.chapter_id is not null then
    insert into public.test_chapter_links(id,user_id,test_id,chapter_id,marks_obtained,total_marks,created_at,updated_at)
      values (coalesce(existing_link.id,gen_random_uuid()),owner_id,target_test_id,test_row.chapter_id,test_row.marks_obtained,test_row.total_marks,
              coalesce(existing_link.created_at,now()),now())
      on conflict (test_id,chapter_id) do update
        set marks_obtained=excluded.marks_obtained,total_marks=excluded.total_marks,updated_at=now()
      returning * into link_row;
  end if;

  return jsonb_build_object('test',to_jsonb(test_row),'subject_score',to_jsonb(score_row),'chapter_link',case when link_row.id is null then null else to_jsonb(link_row) end);
end;
$$;

revoke all on function public.ai_update_test_subject_score(uuid,timestamptz,text,numeric,numeric) from public,anon;
grant execute on function public.ai_update_test_subject_score(uuid,timestamptz,text,numeric,numeric) to authenticated;

-- Preserve Stracker's spaced-revision scheduler while making its related writes atomic.
create or replace function public.ai_complete_revision_atomic(
  target_revision_id uuid,expected_updated_at timestamptz,completion_time timestamptz,next_revision_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog,public
as $$
declare
  owner_id uuid := auth.uid();
  revision_row public.chapter_revisions%rowtype;
  saved_revision public.chapter_revisions%rowtype;
  next_revision public.chapter_revisions%rowtype;
  chapter_row public.chapters%rowtype;
  payload_id uuid;
  payload_chapter_id uuid;
  payload_revision_number integer;
  payload_due_on date;
begin
  if owner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if expected_updated_at is null or completion_time is null then
    raise exception 'revision confirmation is incomplete' using errcode = '22023';
  end if;
  select * into revision_row from public.chapter_revisions
    where id=target_revision_id and user_id=owner_id for update;
  if not found then
    raise exception 'revision not found' using errcode = 'P0002';
  end if;
  if revision_row.completed_at is not null or revision_row.updated_at is distinct from expected_updated_at then
    raise exception 'revision changed after the action was prepared' using errcode = '40001';
  end if;
  select * into chapter_row from public.chapters
    where id=revision_row.chapter_id and user_id=owner_id for update;
  if not found then
    raise exception 'chapter not found' using errcode = 'P0002';
  end if;

  update public.chapter_revisions set completed_at=completion_time,updated_at=completion_time
    where id=target_revision_id and user_id=owner_id returning * into saved_revision;

  if next_revision_payload is not null then
    if jsonb_typeof(next_revision_payload) is distinct from 'object' then
      raise exception 'invalid next revision' using errcode = '22023';
    end if;
    payload_id := nullif(next_revision_payload->>'id','')::uuid;
    payload_chapter_id := nullif(next_revision_payload->>'chapter_id','')::uuid;
    payload_revision_number := nullif(next_revision_payload->>'revision_number','')::integer;
    payload_due_on := nullif(next_revision_payload->>'due_on','')::date;
    if payload_id is null or payload_chapter_id is distinct from revision_row.chapter_id
       or payload_revision_number is distinct from revision_row.revision_number + 1 or payload_due_on is null
       or nullif(next_revision_payload->>'completed_at','') is not null then
      raise exception 'invalid next revision' using errcode = '22023';
    end if;
    insert into public.chapter_revisions(id,user_id,chapter_id,revision_number,due_on,completed_at,created_at,updated_at)
      values (payload_id,owner_id,revision_row.chapter_id,payload_revision_number,payload_due_on,null,completion_time,completion_time)
      on conflict (chapter_id,revision_number) do nothing returning * into next_revision;
  end if;

  if next_revision.id is null then
    select * into next_revision from public.chapter_revisions
      where user_id=owner_id and chapter_id=revision_row.chapter_id and revision_number=revision_row.revision_number + 1;
  end if;

  if chapter_row.status='Done' then
    update public.chapters set status='Revised',updated_at=completion_time
      where id=chapter_row.id and user_id=owner_id and status='Done' returning * into chapter_row;
  end if;
  return jsonb_build_object(
    'completed_revision',to_jsonb(saved_revision),
    'next_revision',case when next_revision.id is null then null else to_jsonb(next_revision) end,
    'chapter',to_jsonb(chapter_row)
  );
end;
$$;

revoke all on function public.ai_complete_revision_atomic(uuid,timestamptz,timestamptz,jsonb) from public,anon;
grant execute on function public.ai_complete_revision_atomic(uuid,timestamptz,timestamptz,jsonb) to authenticated;
notify pgrst,'reload schema';
