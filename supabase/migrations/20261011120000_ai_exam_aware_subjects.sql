-- Exam-aware AI test writes. These three AI functions accepted only Physics/Chemistry/Maths and
-- assumed a Full Mock has exactly three subjects. They now accept any 1-60 character subject
-- (matching the widened chapters/tests checks) and aggregate a Full Mock once every saved subject
-- score is complete. Physics/Chemistry/Maths mocks keep the original all-three rule, so JEE
-- behaviour is unchanged. Signatures, ownership checks and grants are unchanged; no rows touched.

CREATE OR REPLACE FUNCTION public.ai_create_test_with_scores(test_payload jsonb, score_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  legacy_mock boolean := false;
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
  if subject_value is not null and char_length(btrim(subject_value)) not between 1 and 60 then
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
       or item_subject is null or char_length(btrim(item_subject)) not between 1 and 60
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

  if score_count > 30 then
    raise exception 'a Full Mock can contain at most 30 subject scores' using errcode = '22023';
  end if;
  -- Physics/Chemistry/Maths mocks need all three; other exams aggregate every saved subject.
  select coalesce(bool_and(value->>'subject' in ('Physics','Chemistry','Maths')), false)
    into legacy_mock from jsonb_array_elements(coalesce(score_payload,'[]'::jsonb));
  if test_type_value = 'Full Mock' then
    if complete_score_count = score_count and score_count > 0 and (not legacy_mock or score_count = 3) then
      if parent_marks is distinct from score_marks_sum or parent_total is distinct from score_total_sum then
        raise exception 'aggregate marks must match the subject scores' using errcode = '22023';
      end if;
    elsif parent_marks is not null or parent_total is not null then
      raise exception 'aggregate marks require complete subject scores' using errcode = '22023';
    end if;
  end if;

  select * into test_row from public.tests where id = test_id and user_id = owner_id;
  if not found then
    raise exception 'test write was not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object('test',to_jsonb(test_row),'subject_scores',saved_scores);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ai_update_test_record(test_payload jsonb, expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
     or (subject_value is not null and char_length(btrim(subject_value)) not between 1 and 60)
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
$function$
;

CREATE OR REPLACE FUNCTION public.ai_update_test_subject_score(target_test_id uuid, expected_updated_at timestamp with time zone, subject_value text, marks_value numeric, total_value numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  all_score_count integer := 0;
  legacy_mock boolean := false;
begin
  if owner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if expected_updated_at is null or subject_value is null or char_length(btrim(subject_value)) not between 1 and 60
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
         coalesce(sum(total_marks) filter (where marks_obtained is not null and total_marks is not null),0),
         count(*),
         coalesce(bool_and(subject in ('Physics','Chemistry','Maths')), false)
    into complete_score_count,aggregate_marks,aggregate_total,all_score_count,legacy_mock
    from public.test_subject_scores
    where user_id=owner_id and test_subject_scores.test_id=ai_update_test_subject_score.target_test_id;

  if complete_score_count = all_score_count and all_score_count > 0 and (not legacy_mock or all_score_count = 3) then
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
$function$;
