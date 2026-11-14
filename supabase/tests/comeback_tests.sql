-- Tests for comeback.sql. See README.md: run after usage_setup.sql, creators.sql, owner_usage.sql and comeback.sql.
-- Prints COMEBACK TESTS PASSED at the end.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create or replace function public.t(name text, ok boolean) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', name; end if;
  raise notice 'ok  %', name;
end $$;
create or replace function public.expect_error(name text, q text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlerrm ~* pattern then raise notice 'ok  % (%)', name, sqlerrm; return; end if;
    raise exception 'FAIL: % raised "%" not matching "%"', name, sqlerrm, pattern;
  end;
  raise exception 'FAIL: % did not raise', name;
end $$;
create or replace function public.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false)
$$;
grant execute on function public.t(text, boolean), public.expect_error(text, text, text), public.as_user(uuid)
  to anon, authenticated, service_role;
set client_min_messages = notice;

insert into auth.users (id, email, created_at) values
  ('f0000000-0000-0000-0000-0000000000c0', 'owner-c@example.com', now() - interval '60 days'),
  ('c0000000-0000-0000-0000-000000000001', 'c1@example.com', now() - interval '30 days'),
  ('c0000000-0000-0000-0000-000000000002', 'c2@example.com', now() - interval '30 days'),
  ('c0000000-0000-0000-0000-000000000003', 'c3@example.com', now() - interval '30 days'),
  ('c0000000-0000-0000-0000-000000000004', 'c4@example.com', now() - interval '30 days'),
  ('b2d6d7a6-a147-4dfb-9750-375d070cccbf', 'andrea@example.com', now() - interval '90 days')
on conflict (id) do nothing;
insert into creator_owners (email) values ('owner-c@example.com') on conflict do nothing;

-- ---- The table --------------------------------------------------------------------------------------------------------
set role service_role;
insert into comeback_pushes (user_id, stage, quiet_since, sent_at, delivered) values
  ('c0000000-0000-0000-0000-000000000001', 1, current_date - 7, now() - interval '4 days', true);
select expect_error('one row per person, quiet stretch and step',
  $q$insert into comeback_pushes (user_id, stage, quiet_since) values ('c0000000-0000-0000-0000-000000000001', 1, current_date - 7)$q$,
  'comeback_pushes_once');
select expect_error('only steps 1 to 3', $q$insert into comeback_pushes (user_id, stage, quiet_since) values ('c0000000-0000-0000-0000-000000000001', 4, current_date)$q$, 'check');
-- The same step in a later quiet stretch is a new row.
insert into comeback_pushes (user_id, stage, quiet_since, sent_at, delivered, returned_at) values
  ('c0000000-0000-0000-0000-000000000001', 1, current_date - 3, now() - interval '1 day', true, now() - interval '20 hours');
select t('a later quiet stretch can send step 1 again', (select count(*) from comeback_pushes where user_id = 'c0000000-0000-0000-0000-000000000001') = 2);
reset role;

-- ---- Who can read it --------------------------------------------------------------------------------------------------
set role anon;
select as_user(null);
select expect_error('anon cannot read the table', $q$select count(*) from comeback_pushes$q$, 'permission denied');
select expect_error('anon cannot call the stats', $q$select owner_comeback_stats()$q$, 'permission denied');
reset role;
set role authenticated;
select as_user('c0000000-0000-0000-0000-000000000001');
select expect_error('a signed-in user cannot read the table, even their own rows', $q$select count(*) from comeback_pushes$q$, 'permission denied');
select expect_error('a signed-in user cannot write to it', $q$insert into comeback_pushes (user_id, stage, quiet_since) values (auth.uid(), 2, current_date)$q$, 'permission denied');
select expect_error('a user is not the owner', $q$select owner_comeback_stats()$q$, 'not_owner');
reset role;

-- ---- The owner's numbers ----------------------------------------------------------------------------------------------
set role service_role;
insert into comeback_pushes (user_id, stage, quiet_since, sent_at, delivered, returned_at) values
  -- Step 1: c2 came back 5 hours after; c3 came back, but 3 days later (not within 48h); c4 still inside its 48 hours.
  ('c0000000-0000-0000-0000-000000000002', 1, current_date - 10, now() - interval '7 days', true, now() - interval '7 days' + interval '5 hours'),
  ('c0000000-0000-0000-0000-000000000003', 1, current_date - 12, now() - interval '9 days', true, now() - interval '6 days'),
  ('c0000000-0000-0000-0000-000000000004', 1, current_date - 4, now() - interval '20 hours', true, null),
  -- Step 2: c2 never came back; one that never reached a device (not counted).
  ('c0000000-0000-0000-0000-000000000002', 2, current_date - 40, now() - interval '33 days', true, null),
  ('c0000000-0000-0000-0000-000000000003', 2, current_date - 12, now() - interval '5 days', false, null),
  -- Step 3: a test account (left out).
  ('b2d6d7a6-a147-4dfb-9750-375d070cccbf', 3, current_date - 20, now() - interval '6 days', true, null);
reset role;

set role authenticated;
select as_user('f0000000-0000-0000-0000-0000000000c0');
create temp table r as select owner_comeback_stats() as d;
\echo '--- owner_comeback_stats ---'
select jsonb_pretty(d) from r;
create temp table s as select (e->>'stage')::int as stage, e from r, jsonb_array_elements(d->'stages') e;
select t('three steps, in order', (select array_agg(stage order by stage) from s) = array[1, 2, 3]);
select t('step days', (select array_agg((e->>'day')::int order by stage) from s) = array[3, 7, 14]);
select t('step 1 sent (delivered only)', (select (e->>'sent')::int from s where stage = 1) = 5);
select t('step 1 back within 48h (c1''s later push and c2)', (select (e->>'returned')::int from s where stage = 1) = 2);
select t('step 1 still waiting', (select (e->>'waiting')::int from s where stage = 1) = 1);
select t('step 1 rate is of the finished ones (2 of 4)', (select (e->>'returnedPct')::numeric from s where stage = 1) = 50.0);
select t('step 2 counts only the delivered push', (select (e->>'sent')::int from s where stage = 2) = 1);
select t('step 2 none back', (select (e->>'returned')::int from s where stage = 2) = 0 and (select (e->>'returnedPct')::numeric from s where stage = 2) = 0);
select t('step 2 sent in the last 30 days', (select (e->>'sent30d')::int from s where stage = 2) = 0);
select t('step 3 leaves out the test account', (select (e->>'sent')::int from s where stage = 3) = 0 and (select e->'returnedPct' from s where stage = 3) = 'null'::jsonb);
select t('first sent', (select (d->>'firstSentAt')::timestamptz from r) < now() - interval '30 days');
reset role;

-- Staff by email (creator_owners) are left out too.
set role service_role;
insert into comeback_pushes (user_id, stage, quiet_since, sent_at, delivered) values
  ('f0000000-0000-0000-0000-0000000000c0', 3, current_date - 20, now() - interval '3 days', true);
reset role;
set role authenticated;
select as_user('f0000000-0000-0000-0000-0000000000c0');
select t('owner accounts are left out', (select (e->>'sent')::int from jsonb_array_elements(owner_comeback_stats()->'stages') e where (e->>'stage')::int = 3) = 0);
reset role;

-- Deleting an account takes its rows with it.
delete from auth.users where id = 'c0000000-0000-0000-0000-000000000004';
select t('rows go with the account', (select count(*) from comeback_pushes where user_id = 'c0000000-0000-0000-0000-000000000004') = 0);

\echo 'COMEBACK TESTS PASSED'
