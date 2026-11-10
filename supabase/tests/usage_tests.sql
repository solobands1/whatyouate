-- Tests for owner_usage.sql. See README.md: run after usage_setup.sql, creators.sql and owner_usage.sql.
-- Prints USAGE TESTS PASSED at the end.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create function public.t(name text, ok boolean) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', name; end if;
  raise notice 'ok  %', name;
end $$;
create function public.expect_error(name text, q text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlerrm ~* pattern then raise notice 'ok  % (%)', name, sqlerrm; return; end if;
    raise exception 'FAIL: % raised "%" not matching "%"', name, sqlerrm, pattern;
  end;
  raise exception 'FAIL: % did not raise', name;
end $$;
create function public.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false)
$$;
-- A meal i ago, as the app saves it (ts in ms). src 'supplement' for a supplement.
create function public.add_meal(u uuid, i interval, src text default null, st text default 'done') returns void language sql as $$
  insert into meals (user_id, ts, created_at, status, analysis_json)
  values (u, (extract(epoch from now() - i) * 1000)::bigint, now() - i, st,
          case when src is null then '{"estimated_ranges": {}}'::jsonb else jsonb_build_object('source', src) end)
$$;
-- The local date (UTC-5, offset 300) of the moment i ago, as the app writes reflection dates.
create function public.lday(i interval) returns text language sql as $$
  select to_char((((now() - i) at time zone 'UTC') - interval '300 minutes')::date, 'YYYY-MM-DD')
$$;
create function public.reflection(i interval) returns jsonb language sql as $$
  select jsonb_build_object('date', lday(i), 'answers', '{}'::jsonb, 'note', '', 'ts', (extract(epoch from now() - i) * 1000)::bigint)
$$;
grant execute on function public.t(text, boolean), public.expect_error(text, text, text), public.as_user(uuid)
  to anon, authenticated, service_role;
set client_min_messages = notice;

-- ---- People at every step ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, created_at, raw_user_meta_data) values
  ('f0000000-0000-0000-0000-000000000000', 'owner@example.com', now() - interval '60 days', '{"first_name": "Olive"}'),
  ('00000000-0000-0000-0000-000000000001', 'u1@example.com', now() - interval '2 days', '{"first_name": "Never", "last_name": "Onboarded"}'),
  ('00000000-0000-0000-0000-000000000002', 'u2@example.com', now() - interval '5 days', '{}'),
  ('00000000-0000-0000-0000-000000000003', 'u3@example.com', now() - interval '10 days', '{}'),
  ('00000000-0000-0000-0000-000000000004', 'u4@example.com', now() - interval '2 days', '{}'),
  ('00000000-0000-0000-0000-000000000005', 'u5@example.com', now() - interval '20 days', '{}'),
  ('00000000-0000-0000-0000-000000000006', 'u6@example.com', now() - interval '9 days', '{}'),
  ('00000000-0000-0000-0000-000000000007', 'u7@example.com', now() - interval '8 days', '{}'),
  ('00000000-0000-0000-0000-000000000008', 'u8@example.com', now() - interval '40 days', '{}'),
  ('00000000-0000-0000-0000-000000000009', 'u9@example.com', now() - interval '15 days', '{}'),
  ('4ef35614-32ec-4a17-b410-f4c31437c1bc', 'dillon@example.com', now() - interval '200 days', '{}'),
  ('00000000-0000-0000-0000-000000000011', 'creator@example.com', now() - interval '20 days', '{}'),
  ('00000000-0000-0000-0000-000000000012', 'u12@example.com', now() - interval '12 days', '{}'),
  ('00000000-0000-0000-0000-000000000013', 'u13@example.com', now() - interval '30 days', '{}'),
  ('00000000-0000-0000-0000-000000000014', 'u14@example.com', now() - interval '3 days', '{}'),
  ('00000000-0000-0000-0000-000000000015', 'u15@example.com', now() - interval '4 days', '{}');
insert into creator_owners (email) values ('owner@example.com');

insert into profiles (user_id, first_name, last_name, timezone_offset_minutes, onboarding_done, walkthrough_done) values
  ('f0000000-0000-0000-0000-000000000000', 'Olive', 'Owner', 300, true, true),
  ('00000000-0000-0000-0000-000000000002', 'Two', 'Onboarded', 300, true, false),
  ('00000000-0000-0000-0000-000000000003', 'Three', 'OneMeal', 300, true, true),
  ('00000000-0000-0000-0000-000000000004', 'Four', 'Reflected', 300, true, true),
  ('00000000-0000-0000-0000-000000000005', 'Five', 'CameBack', 300, true, true),
  ('00000000-0000-0000-0000-000000000006', 'Six', 'Picture', 300, true, true),
  ('00000000-0000-0000-0000-000000000007', 'Seven', 'Trial', 300, true, true),
  ('00000000-0000-0000-0000-000000000008', 'Eight', 'PayingQuiet', 300, true, true),
  ('00000000-0000-0000-0000-000000000009', 'Nine', 'Paying', 300, true, true),
  ('4ef35614-32ec-4a17-b410-f4c31437c1bc', 'Dillon', '', 300, true, true),
  ('00000000-0000-0000-0000-000000000012', 'Twelve', 'PaidNoCheckIn', 300, true, true),
  ('00000000-0000-0000-0000-000000000013', 'Thirteen', 'Expired', 300, true, true),
  ('00000000-0000-0000-0000-000000000014', 'Fourteen', 'Legacy', 300, null, null),
  ('00000000-0000-0000-0000-000000000015', 'Fifteen', 'Supplements', 300, true, true);

-- U3: one meal 10 days ago.
select add_meal('00000000-0000-0000-0000-000000000003', '10 days');
-- U4: a meal and that night's check-in, 30 hours ago.
select add_meal('00000000-0000-0000-0000-000000000004', '30 hours');
update profiles set reflections_json = jsonb_build_array(reflection('30 hours')) where user_id = '00000000-0000-0000-0000-000000000004';
-- U5: back on a second day, then gone; free window ended 6 days ago (14 days after the first meal).
select add_meal('00000000-0000-0000-0000-000000000005', i) from unnest(array['20 days', '19 days', '19 days', '19 days']::interval[]) i;
update profiles set reflections_json = jsonb_build_array(reflection('20 days')) where user_id = '00000000-0000-0000-0000-000000000005';
-- U6: 6 meals on 5 days (picture built 5 days ago, free window ended 3 days ago), water, a Health sync.
select add_meal('00000000-0000-0000-0000-000000000006', i) from unnest(array['9 days', '9 days', '8 days', '7 days', '6 days', '5 days']::interval[]) i;
update profiles set reflections_json = jsonb_build_array(reflection('8 days'), '"junk"'::jsonb, jsonb_build_object('date', '2026-02-30')),
  water_logs_json = jsonb_build_object(lday('5 days'), 500, 'goal', 2000, '2026-13-01', 300)
  where user_id = '00000000-0000-0000-0000-000000000006';
insert into step_logs (user_id, date, steps, synced_at) values
  ('00000000-0000-0000-0000-000000000006', current_date - 6, 4000, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000006', current_date - 5, 5000, now() - interval '5 days');
-- U7: picture built, Apple trial ending tomorrow, logged a minute ago.
select add_meal('00000000-0000-0000-0000-000000000007', i) from unnest(array['8 days', '7 days', '6 days', '5 days', '4 days', '1 minute']::interval[]) i;
update profiles set reflections_json = jsonb_build_array(reflection('7 days')) where user_id = '00000000-0000-0000-0000-000000000007';
insert into user_subscription_status (user_id, status, product_id, period_type, expires_at, will_renew, store, last_event_type, last_event_at, trial_started_at)
values ('00000000-0000-0000-0000-000000000007', 'trial', 'monthly', 'TRIAL', now() + interval '1 day', true, 'APP_STORE', 'INITIAL_PURCHASE', now() - interval '2 days', now() - interval '2 days');
-- U8: paying, nothing for 10 days.
select add_meal('00000000-0000-0000-0000-000000000008', i) from unnest(array['40 days', '39 days', '38 days', '37 days', '36 days', '10 days']::interval[]) i;
update profiles set reflections_json = jsonb_build_array(reflection('39 days')) where user_id = '00000000-0000-0000-0000-000000000008';
insert into user_subscription_status (user_id, status, product_id, period_type, expires_at, will_renew, last_event_type, last_event_at, trial_started_at, first_paid_at)
values ('00000000-0000-0000-0000-000000000008', 'subscribed', 'monthly', 'NORMAL', now() + interval '20 days', true, 'RENEWAL', now() - interval '3 days', now() - interval '40 days', now() - interval '33 days');
-- U9: paying, came from creator code SARAH, logged and checked in today, push on.
insert into creators (id, user_id, email, name, country, payout_method, payout_email, code)
values ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 'creator@example.com', 'Sarah', 'CA', 'etransfer', 'creator@example.com', 'SARAH');
insert into creator_codes (code, creator_id) values ('SARAH', 'c0000000-0000-0000-0000-000000000001');
insert into referrals (user_id, creator_id, code, account_created_at, first_paid_at)
values ('00000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000001', 'SARAH', now() - interval '15 days', now() - interval '3 days');
select add_meal('00000000-0000-0000-0000-000000000009', i) from unnest(array['15 days', '14 days', '13 days', '12 days', '11 days', '2 minutes']::interval[]) i;
update profiles set reflections_json = jsonb_build_array(reflection('1 minute'), reflection('14 days')) where user_id = '00000000-0000-0000-0000-000000000009';
insert into feel_logs (user_id, ts, tag) values ('00000000-0000-0000-0000-000000000009', extract(epoch from now() - interval '3 minutes')::bigint, 'energized');
insert into push_tokens (user_id, token, platform) values ('00000000-0000-0000-0000-000000000009', 'tok', 'ios');
insert into user_subscription_status (user_id, status, product_id, period_type, expires_at, will_renew, last_event_type, last_event_at, first_paid_at)
values ('00000000-0000-0000-0000-000000000009', 'subscribed', 'monthly_creator', 'NORMAL', now() + interval '27 days', true, 'RENEWAL', now() - interval '3 days', now() - interval '3 days');
-- Dillon (internal): busy today, never counted.
select add_meal('4ef35614-32ec-4a17-b410-f4c31437c1bc', i) from unnest(array['1 minute', '2 minutes', '3 minutes']::interval[]) i;
-- U12: paying without ever doing a check-in.
select add_meal('00000000-0000-0000-0000-000000000012', i) from unnest(array['12 days', '11 days', '10 days', '9 days', '8 days']::interval[]) i;
insert into user_subscription_status (user_id, status, product_id, period_type, expires_at, will_renew, last_event_type, last_event_at, first_paid_at)
values ('00000000-0000-0000-0000-000000000012', 'subscribed', 'yearly', 'NORMAL', now() + interval '300 days', true, 'INITIAL_PURCHASE', now() - interval '8 days', now() - interval '8 days');
-- U13: a subscription that ran out without an EXPIRATION event yet.
select add_meal('00000000-0000-0000-0000-000000000013', '30 days');
insert into user_subscription_status (user_id, status, product_id, period_type, expires_at, will_renew, last_event_type, last_event_at)
values ('00000000-0000-0000-0000-000000000013', 'subscribed', 'monthly', 'NORMAL', now() - interval '2 days', true, 'RENEWAL', now() - interval '32 days');
-- U14: an older account from before onboarding_done existed.
select add_meal('00000000-0000-0000-0000-000000000014', '2 days');
-- U15: only supplements and a failed photo.
select add_meal('00000000-0000-0000-0000-000000000015', '1 day', 'supplement');
select add_meal('00000000-0000-0000-0000-000000000015', '2 days', 'supplement');
select add_meal('00000000-0000-0000-0000-000000000015', '1 day', null, 'failed');

-- ---- Who can call what ------------------------------------------------------------------------------------------------
set role anon;
select as_user(null);
select expect_error('anon cannot call owner_usage', $q$select owner_usage(30)$q$, 'permission denied');
reset role;
set role authenticated;
select as_user('00000000-0000-0000-0000-000000000009');
select expect_error('a user is not the owner', $q$select owner_usage(30)$q$, 'not_owner');
select expect_error('a user cannot read the summary', $q$select owner_usage_summary()$q$, 'not_owner');
select expect_error('a user cannot call the event helper', $q$select count(*) from usage_events()$q$, 'permission denied');
select expect_error('a user cannot call the facts helper', $q$select usage_all_facts()$q$, 'permission denied');
select expect_error('a user cannot record a subscription', $q$select usage_record_subscription('00000000-0000-0000-0000-000000000009', 'subscribed', null, null, null, true, null, 'X', now())$q$, 'permission denied');
select t('a user cannot read subscription rows', (select count(*) from user_subscription_status) = 0);
reset role;

-- ---- The owner's numbers ----------------------------------------------------------------------------------------------
set role authenticated;
select as_user('f0000000-0000-0000-0000-000000000000');
create temp table r as select owner_usage(30) as d;
\echo '--- summary ---'
select jsonb_pretty(d->'summary') from r;
select t('total users leaves out staff, test and website-only accounts', (d->'summary'->>'totalUsers')::int = 13) from r;
select t('signups in 7 days', (d->'summary'->>'signups7d')::int = 5) from r;
select t('signups in 30 days', (d->'summary'->>'signups30d')::int = 11) from r;
select t('active today', (d->'summary'->>'activeToday')::int = 2) from r;
select t('active in 7 days', (d->'summary'->>'active7d')::int = 6) from r;
select t('active in 30 days', (d->'summary'->>'active30d')::int = 10) from r;
select t('meals today (Dillon''s not counted)', (d->'summary'->>'mealsToday')::int = 2) from r;
select t('statuses', d->'summary'->'byStatus' = '{"not_started": 3, "free_window": 3, "free_ended": 2, "trial": 1, "subscribed": 3, "expired": 1}'::jsonb) from r;
select t('internal accounts counted apart', (d->'summary'->>'internal')::int = 2) from r;
select t('website-only accounts counted apart', (d->'summary'->>'siteOnly')::int = 1) from r;

\echo '--- funnel, all time ---'
select s->>'n' as n, s->>'label' as step, s->>'reached' as reached, s->>'didIt' as did_it, s->>'lost' as lost, s->>'keptPct' as kept_pct
from r, jsonb_array_elements(d->'funnels'->'all'->'stages') s;
select t('funnel cohort', (d->'funnels'->'all'->>'cohort')::int = 13) from r;
select t('funnel reached, step by step',
  (select array_agg((s->>'reached')::int order by (s->>'n')::int) from jsonb_array_elements(d->'funnels'->'all'->'stages') s)
  = array[13, 12, 10, 8, 7, 6, 5, 3]) from r;
select t('did it at all, in any order',
  (select array_agg((s->>'didIt')::int order by (s->>'n')::int) from jsonb_array_elements(d->'funnels'->'all'->'stages') s)
  = array[13, 12, 10, 6, 7, 5, 5, 3]) from r;
select t('biggest drop: the earliest of the steps that lose the most', (d->'funnels'->'all'->>'biggestDrop')::int = 3) from r;
select t('kept percentage', (d->'funnels'->'all'->'stages'->3->>'keptPct')::numeric = 80.0) from r;
select t('paid without a check-in still counts as paying', (select (x->>'stage')::int from r, jsonb_array_elements(d->'users') x where x->>'id' = '00000000-0000-0000-0000-000000000012') = 8) from r;
select t('no meal, no further than onboarding', (select (x->>'stage')::int from r, jsonb_array_elements(d->'users') x where x->>'id' = '00000000-0000-0000-0000-000000000015') = 2) from r;
select t('7-day cohort', (d->'funnels'->'7'->>'cohort')::int = 5 and (d->'funnels'->'7'->>'recent')::int = 5) from r;
select t('30-day cohort', (d->'funnels'->'30'->>'cohort')::int = 11) from r;
select t('90-day cohort', (d->'funnels'->'90'->>'cohort')::int = 13) from r;

\echo '--- users ---'
select u->>'name' as name, u->>'stage' as stage, u->>'status' as status, u->>'totalMeals' as meals, u->>'logs7d' as logs7d,
  u->>'activeDays' as days, u->>'reflectedToday' as refl_today, u->'flags' as flags, u->>'internal' as internal
from r, jsonb_array_elements(d->'users') u;
create temp table u as select (x->>'id')::uuid as id, x from r, jsonb_array_elements(d->'users') x;
select t('website-only creator account not listed', not exists (select 1 from u where id = '00000000-0000-0000-0000-000000000011'));
select t('staff listed and marked', (select (x->>'internal')::boolean from u where id = '4ef35614-32ec-4a17-b410-f4c31437c1bc'));
select t('name falls back to sign-up name', (select x->>'name' from u where id = '00000000-0000-0000-0000-000000000001') = 'Never Onboarded');
select t('name from the profile', (select x->>'name' from u where id = '00000000-0000-0000-0000-000000000002') = 'Two Onboarded');
select t('legacy account counts as onboarded', (select (x->>'stage')::int from u where id = '00000000-0000-0000-0000-000000000014') = 3);
select t('supplements are not meals', (select (x->>'totalMeals')::int from u where id = '00000000-0000-0000-0000-000000000015') = 0);
select t('supplements are activity, failed photos are not', (select (x->>'logs7d')::int from u where id = '00000000-0000-0000-0000-000000000015') = 2);
select t('picture built at the 5th day', (select abs(extract(epoch from (x->>'coreAt')::timestamptz - (now() - interval '5 days'))) < 60 from u where id = '00000000-0000-0000-0000-000000000006'));
select t('free window ends 2 days after the picture', (select abs(extract(epoch from (x->>'freeEndsAt')::timestamptz - (now() - interval '3 days'))) < 60 from u where id = '00000000-0000-0000-0000-000000000006'));
select t('backstop: 14 days after the first meal', (select abs(extract(epoch from (x->>'freeEndsAt')::timestamptz - (now() - interval '6 days'))) < 60 from u where id = '00000000-0000-0000-0000-000000000005'));
select t('water, Health sync and bad entries: U6 active on 5 days', (select (x->>'activeDays')::int from u where id = '00000000-0000-0000-0000-000000000006') = 5);
select t('reflected today', (select (x->>'reflectedToday')::boolean and (x->>'logsToday')::int = 3 from u where id = '00000000-0000-0000-0000-000000000009'));
select t('push and creator code', (select (x->>'pushEnabled')::boolean and x->>'platform' = 'ios' and x->>'code' = 'SARAH' from u where id = '00000000-0000-0000-0000-000000000009'));
select t('ran-out subscription shows expired', (select x->>'status' from u where id = '00000000-0000-0000-0000-000000000013') = 'expired');
select t('default order is last activity', (select x->>'id' from r, jsonb_array_elements(d->'users') with ordinality as e(x, i) where i = 1) in
  ('4ef35614-32ec-4a17-b410-f4c31437c1bc', '00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000009'));

\echo '--- follow-ups ---'
select jsonb_pretty(owner_usage_follow_ups());
create temp table fl as select key as flag, (select array_agg(p->>'email' order by p->>'email') from jsonb_array_elements(value) p) as emails
  from jsonb_each(owner_usage_follow_ups());
select t('never onboarded', (select emails from fl where flag = 'never_onboarded') = array['u1@example.com']);
select t('no meal by day 3', (select emails from fl where flag = 'no_meal_day3') = array['u15@example.com', 'u2@example.com']);
select t('still logging at day 7', (select emails from fl where flag = 'still_logging_day7') = array['u7@example.com', 'u9@example.com']);
select t('trial ending and active', (select emails from fl where flag = 'trial_ending') = array['u7@example.com']);
select t('paying but quiet 7 days', (select emails from fl where flag = 'paying_quiet') = array['u12@example.com', 'u8@example.com']);
select t('hit the paywall, no trial', (select emails from fl where flag = 'paywall_no_trial') = array['u5@example.com', 'u6@example.com']);
select t('no flags for staff', not exists (select 1 from fl where 'dillon@example.com' = any (emails) or 'owner@example.com' = any (emails)));

\echo '--- daily ---'
select x->>'day' as day, x->>'signups' as signups, x->>'active' as active, x->>'meals' as meals, x->>'reflections' as refl
from r, jsonb_array_elements(d->'daily') x offset 20;
select t('30 days, ending today (Toronto)', jsonb_array_length(d->'daily') = 30
  and (d->'daily'->29->>'day')::date = (now() at time zone 'America/Toronto')::date) from r;
select t('daily signups add up', (select sum((x->>'signups')::int) from jsonb_array_elements(d->'daily') x) = 11) from r;
select t('daily matches standalone function', owner_usage_daily(30) = d->'daily') from r;
select t('standalone summary matches', owner_usage_summary() - 'generatedAt' = (d->'summary') - 'generatedAt') from r;
select t('standalone funnel matches', owner_usage_funnel(30) = d->'funnels'->'30') from r;
select t('standalone users matches', owner_usage_users() = d->'users') from r;
select t('all-time funnel', owner_usage_funnel(null) = d->'funnels'->'all') from r;
reset role;

-- ---- Recording RevenueCat states ------------------------------------------------------------------------------------
set role service_role;
select t('records', usage_record_subscription('00000000-0000-0000-0000-000000000003', 'trial', 'monthly', 'trial', now() + interval '7 days', true, 'APP_STORE', 'INITIAL_PURCHASE', now() - interval '1 hour', now() - interval '1 hour', null) = 'recorded');
select t('period type upper-cased', (select period_type from user_subscription_status where user_id = '00000000-0000-0000-0000-000000000003') = 'TRIAL');
select t('newer event wins', usage_record_subscription('00000000-0000-0000-0000-000000000003', 'billing_issue', 'monthly', 'NORMAL', now() + interval '7 days', true, null, 'BILLING_ISSUE', now()) = 'recorded');
select t('an older event arriving late doesn''t roll it back', usage_record_subscription('00000000-0000-0000-0000-000000000003', 'subscribed', 'monthly', 'NORMAL', now() + interval '30 days', true, null, 'RENEWAL', now() - interval '30 minutes', null, now() - interval '30 minutes') = 'recorded');
select t('status kept', (select status = 'billing_issue' and last_event_type = 'BILLING_ISSUE' from user_subscription_status where user_id = '00000000-0000-0000-0000-000000000003'));
select t('but first paid is filled in, and trial start kept', (select first_paid_at is not null and trial_started_at is not null and store = 'APP_STORE' from user_subscription_status where user_id = '00000000-0000-0000-0000-000000000003'));
select t('unknown user', usage_record_subscription(gen_random_uuid(), 'trial', null, null, null, true, null, 'X', now()) = 'unknown_user');
select t('bad status', usage_record_subscription('00000000-0000-0000-0000-000000000003', 'lifetime', null, null, null, true, null, 'X', now()) = 'bad_status');
reset role;

-- ---- Rerunning the file is harmless (checked by the runner) and the meal indexes match the query -------------------------
create index meals_real_user_ts_idx on public.meals (user_id, ts, created_at)
  where coalesce(status, 'done') <> 'failed' and coalesce(analysis_json->>'source', '') <> 'supplement';
create index meals_supplement_user_ts_idx on public.meals (user_id, ts, created_at)
  where coalesce(status, 'done') <> 'failed' and analysis_json->>'source' = 'supplement';
vacuum analyze public.meals;
set enable_seqscan = off;
create temp table plan_lines (line text);
do $$
declare l text;
begin
  for l in execute $q$explain (costs off) select m.user_id, m.ts, m.created_at from meals m
    where coalesce(status, 'done') <> 'failed' and coalesce(analysis_json->>'source', '') <> 'supplement'$q$ loop
    insert into plan_lines values (l);
  end loop;
end $$;
select t('real meals read from the partial index alone', exists (select 1 from plan_lines where line ~ 'Index Only Scan using meals_real_user_ts_idx'));
reset enable_seqscan;

\echo 'USAGE TESTS PASSED'
