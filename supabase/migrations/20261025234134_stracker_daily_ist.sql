-- Stracker AI (Default) daily limit resets at 12:00 AM Asia/Kolkata (IST calendar day),
-- instead of a rolling 24-hour window. Additive: no rows are deleted or changed; events
-- from earlier IST days simply stop counting. Same atomic, server-only pattern as
-- ai_take_rate_slot (advisory lock per user + bucket, service_role only).
create or replace function public.ai_ist_day_start(at_time timestamptz default now())
returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select (date_trunc('day', at_time at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata'
$$;

create or replace function public.ai_take_daily_slot(owner uuid, bucket text, per_user_limit integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  taken integer;
  day_start timestamptz := public.ai_ist_day_start(now());
begin
  if owner is null
     or bucket is null
     or char_length(bucket) not between 1 and 40
     or per_user_limit is null
     or per_user_limit < 1
     or per_user_limit > 1000 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('stracker-ai-rate'), hashtext(owner::text || ':' || bucket));

  select count(*) into taken
  from public.ai_rate_events
  where user_id = owner
    and ai_rate_events.bucket = ai_take_daily_slot.bucket
    and created_at >= day_start;

  if taken >= per_user_limit then
    return false;
  end if;

  insert into public.ai_rate_events (user_id, bucket) values (owner, bucket);
  return true;
end;
$$;

revoke all on function public.ai_ist_day_start(timestamptz) from public, anon, authenticated;
grant execute on function public.ai_ist_day_start(timestamptz) to service_role;
revoke all on function public.ai_take_daily_slot(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ai_take_daily_slot(uuid, text, integer) to service_role;
