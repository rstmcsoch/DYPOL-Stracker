-- A Full Mock prepared by Stracker AI can be saved with only its overall score (marks and total),
-- the same as the app's own Add test form and analytics already allow. Until now this function
-- rejected any aggregate without a complete subject split, so the assistant kept asking students
-- for per-subject marks and totals. Only that one branch changes: with subject scores present,
-- the aggregate must still match a complete split exactly. Signature, ownership checks, RLS and
-- grants are unchanged; no rows are touched.

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
    elsif score_count > 0 and (parent_marks is not null or parent_total is not null) then
      -- With no subject scores the overall marks/total are the score (checked above).
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
