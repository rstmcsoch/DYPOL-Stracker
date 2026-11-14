-- Wider disposable-domain coverage: merge three free, open lists (normal lists only, never the
-- stricter variants that include legitimate alias/forwarding providers):
--   * disposable-email-domains/disposable-email-domains  disposable_email_blocklist.conf (~10k)
--   * disposable/disposable-email-domains               domains.txt                    (~108k)
--   * 7c/fakefilter                                       txt/data.txt                   (~11k)
-- Built-in always-allowed providers and the owner's "always allow" rules stay authoritative
-- (is_disposable_email checks them first). Additive and forward-only.

alter table public.disposable_email_domain_refreshes add column if not exists source text
  check (source is null or char_length(source) <= 40);
alter table public.disposable_email_domain_refreshes add column if not exists batch_id bigint;

-- One download per source, grouped by batch.
create or replace function public.disposable_domains_refresh_request()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch bigint;
  src record;
begin
  for src in
    select * from (values
      ('github-main', 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf'),
      ('disposable', 'https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.txt'),
      ('fakefilter', 'https://raw.githubusercontent.com/7c/fakefilter/main/txt/data.txt')
    ) as s(name, url)
  loop
    insert into public.disposable_email_domain_refreshes (request_id, source, batch_id)
      values (net.http_get(url := src.url, timeout_milliseconds := 30000), src.name, batch)
      returning coalesce(batch_id, id) into batch;
    update public.disposable_email_domain_refreshes set batch_id = batch where batch_id is null and id = batch;
  end loop;
  return batch;
end;
$$;
revoke all on function public.disposable_domains_refresh_request() from public, anon, authenticated;

-- Applies the newest batch once every source has answered (or 2 hours have passed).
--  * every source must pass its own sanity floor to count;
--  * all sources good → full sync (domains dropped upstream are removed);
--  * some source bad → add-only (nothing is removed), so one outage never shrinks the list;
--  * no good source → nothing changes.
create or replace function public.disposable_domains_refresh_apply()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest bigint;
  row_ public.disposable_email_domain_refreshes%rowtype;
  response_status integer;
  response_body text;
  floor_ integer;
  parsed integer;
  pending integer := 0;
  good integer := 0;
  bad integer := 0;
  total integer;
begin
  select coalesce(batch_id, id) into latest from public.disposable_email_domain_refreshes
    where applied_at is null order by id desc limit 1;
  if latest is null then return 'nothing_pending'; end if;

  -- Older unanswered batches are replaced by the newest one.
  update public.disposable_email_domain_refreshes set applied_at = timezone('utc', now()), outcome = 'superseded'
    where applied_at is null and coalesce(batch_id, id) < latest;

  create temporary table if not exists disposable_domains_incoming (domain text primary key) on commit drop;
  truncate disposable_domains_incoming;

  -- Wait while any source of the batch has not answered yet (up to 2 hours).
  for row_ in select * from public.disposable_email_domain_refreshes where coalesce(batch_id, id) = latest and applied_at is null order by id loop
    perform 1 from net._http_response r where r.id = row_.request_id;
    if not found and row_.requested_at > timezone('utc', now()) - interval '2 hours' then pending := pending + 1; end if;
  end loop;
  if pending > 0 then return 'waiting'; end if;

  for row_ in select * from public.disposable_email_domain_refreshes where coalesce(batch_id, id) = latest and applied_at is null order by id loop
    response_status := null; response_body := null;
    select r.status_code, r.content into response_status, response_body from net._http_response r where r.id = row_.request_id;
    floor_ := case coalesce(row_.source, 'github-main') when 'disposable' then 20000 else 1000 end;
    if response_status is distinct from 200 or response_body is null then
      update public.disposable_email_domain_refreshes set applied_at = timezone('utc', now()), outcome = 'http_' || coalesce(response_status::text, 'none') where id = row_.id;
      bad := bad + 1;
      continue;
    end if;
    with lines as (
      select distinct lower(btrim(line)) as d from regexp_split_to_table(response_body, E'\n') as line
    ), valid as (
      select d from lines
      where char_length(d) between 3 and 253
        and d ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
        and not public.never_block_email_domain(d)
    )
    select count(*) into parsed from valid;
    if parsed < floor_ then
      update public.disposable_email_domain_refreshes set applied_at = timezone('utc', now()), outcome = 'too_small', domain_count = parsed where id = row_.id;
      bad := bad + 1;
      continue;
    end if;
    insert into disposable_domains_incoming (domain)
      select d from (select distinct lower(btrim(line)) as d from regexp_split_to_table(response_body, E'\n') as line) l
      where char_length(d) between 3 and 253
        and d ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
        and not public.never_block_email_domain(d)
      on conflict (domain) do nothing;
    update public.disposable_email_domain_refreshes set applied_at = timezone('utc', now()), outcome = 'applied', domain_count = parsed where id = row_.id;
    good := good + 1;
  end loop;

  if good = 0 then return 'no_good_source'; end if;
  insert into public.disposable_email_domains (domain)
    select domain from disposable_domains_incoming
    on conflict (domain) do nothing;
  if bad = 0 then
    delete from public.disposable_email_domains existing
      where not exists (select 1 from disposable_domains_incoming i where i.domain = existing.domain);
  end if;
  select count(*) into total from public.disposable_email_domains;
  return case when bad = 0 then 'applied' else 'applied_add_only' end || ':' || total;
end;
$$;
revoke all on function public.disposable_domains_refresh_apply() from public, anon, authenticated;

-- Two of the sources regenerate daily, so download daily instead of weekly (03:17 UTC = 08:47 IST).
select cron.schedule('stracker-disposable-domains-request', '17 3 * * *', $$select public.disposable_domains_refresh_request()$$);

-- Download the merged lists right away; the hourly apply job (or a manual apply) loads them.
select public.disposable_domains_refresh_request();
