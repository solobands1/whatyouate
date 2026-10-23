\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Test helpers (owned by the superuser, not security definer, so they run as the caller).
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
grant execute on function public.t(text, boolean), public.expect_error(text, text, text), public.as_user(uuid)
  to anon, authenticated, service_role;
set client_min_messages = notice;

-- People: two creators, several app users.
insert into auth.users (id, email, created_at) values
  ('a0000000-0000-0000-0000-000000000001', 'sarah@example.com', now() - interval '60 days'),
  ('b0000000-0000-0000-0000-000000000002', 'mike@example.com', now() - interval '60 days'),
  ('10000000-0000-0000-0000-000000000001', 'u1@example.com', now() - interval '1 hour'),
  ('20000000-0000-0000-0000-000000000002', 'u2@example.com', now() - interval '30 days'),
  ('30000000-0000-0000-0000-000000000003', 'u3@example.com', now() - interval '1 hour'),
  ('40000000-0000-0000-0000-000000000004', 'u4@example.com', now() - interval '1 hour'),
  ('50000000-0000-0000-0000-000000000005', 'u5@example.com', now() - interval '1 hour'),
  ('60000000-0000-0000-0000-000000000006', 'u6@example.com', now() - interval '1 hour'),
  ('70000000-0000-0000-0000-000000000007', 'u7@example.com', now() - interval '1 hour');
insert into public.profiles (user_id, timezone_offset_minutes) values
  ('10000000-0000-0000-0000-000000000001', 300), ('30000000-0000-0000-0000-000000000003', 300);

-- Apple codes for creators' free Pro: two 3-month codes and one year code.
set role service_role;
select t('codes loaded', creator_add_pro_codes('3_months', array['THREE1', 'THREE2', ' THREE1 ', '']) = 2);
select t('year code loaded', creator_add_pro_codes('1_year', array['YEAR1']) = 1);
select t('known codes skipped', creator_add_pro_codes('3_months', array['THREE1']) = 0);
reset role;
set role authenticated;
select expect_error('users cannot load codes', $q$select creator_add_pro_codes('1_year', array['X'])$q$, 'permission denied');
select expect_error('users cannot grab codes', $q$select creator_assign_pro_code(gen_random_uuid(), '1_year')$q$, 'permission denied');
select t('users cannot read the code pool', (select count(*) from creator_pro_codes) = 0);
reset role;

-- ---- Code checks (anon) ------------------------------------------------------------
set role anon;
select as_user(null);
select t('short code rejected', creator_check_code('ab') = 'short');
select t('long code rejected', creator_check_code('abcdefghijklmnop') = 'long');
select t('reserved code rejected', creator_check_code('What You Ate') = 'reserved');
select t('offensive code rejected', creator_check_code('sexyfood') = 'blocked');
select t('free code ok', creator_check_code('sarah') is null);
select expect_error('anon cannot join', $q$select creator_join('x','','','ANON1','US','paypal','x@x.com')$q$, 'permission denied');
select expect_error('anon cannot redeem', $q$select redeem_creator_code('SARAH')$q$, 'permission denied');
select t('anon sees no creators', (select count(*) from creators) = 0);
reset role;

-- ---- Joining -------------------------------------------------------------------------
set role authenticated;
select as_user('a0000000-0000-0000-0000-000000000001');
select t('sarah joins', (select code from creator_join('Sarah Chen', 'sarahs.gut.kitchen', '', ' sarah! ', 'CA', 'etransfer', 'sarah@example.com')) = 'SARAH');
select t('sarah earns in CAD', (select currency from creators) = 'CAD');
select t('sarah sees only her row', (select count(*) from creators) = 1);
select expect_error('cannot join twice', $q$select creator_join('Sarah','','','SARAH2','CA','etransfer','s@x.com')$q$, 'already_joined');

select t('no free Pro before a qualified signup', (creator_dashboard()->'pro'->>'threeMonths') is null);
select t('dashboard says Pro is still locked', (creator_dashboard()->'pro'->>'unlocked')::boolean = false);
select as_user('b0000000-0000-0000-0000-000000000002');
select expect_error('taken code refused', $q$select creator_join('Mike','','mikeeats','Sarah','US','wise','m@x.com')$q$, 'code_taken');
select expect_error('canadian payout must be interac', $q$select creator_join('Mike','','','MIKE','CA','paypal','m@x.com')$q$, 'creators_payout_matches_country');
select t('mike joins', (select code from creator_join('Mike', '', 'mikeeats', 'mike', 'US', 'wise', 'mike@example.com')) = 'MIKE');
select t('mike has no free Pro yet either', (creator_dashboard()->'pro'->>'threeMonths') is null);
select t('no year code yet', (creator_dashboard()->'pro'->>'year') is null);
select t('mike earns in USD', (select currency from creators) = 'USD');
select t('mike sees only his row', (select count(*) from creators) = 1);
update creators set code = 'HACKED', payout_email = 'evil@x.com' where true;
select t('creator cannot write own row directly', (select code = 'MIKE' and payout_email = 'mike@example.com' from creators));
delete from creator_codes where true;

-- ---- Changing codes ------------------------------------------------------------------
select as_user('a0000000-0000-0000-0000-000000000001');
select t('sarah changes code', (select code from creator_change_code('sarahc')) = 'SARAHC');
select t('sarah can pick her old code again', creator_check_code('SARAH') is null);
select as_user('b0000000-0000-0000-0000-000000000002');
select t('old code still taken for others', creator_check_code('SARAH') = 'taken');
select expect_error('mike cannot take sarahs old code', $q$select creator_change_code('SARAH')$q$, 'code_taken');

-- ---- Redeeming in the app ------------------------------------------------------------
select as_user('10000000-0000-0000-0000-000000000001');
select t('new user redeems old code', (redeem_creator_code('sarah')->>'ok')::boolean);
select t('second redeem refused', redeem_creator_code('MIKE')->>'reason' = 'already_redeemed');
select t('user sees own referral', (select count(*) from referrals) = 1);
select t('referral went to sarah', (select code from referrals) = 'SARAH');
select t('user sees no earnings', (select count(*) from creator_earnings) = 0);
update referrals set creator_id = (select creator_id from referrals) where true;
update referrals set code = 'MIKE' where true;
select t('user cannot move their referral', (select code = 'SARAH' from referrals));
select expect_error('user cannot insert a referral', $q$insert into referrals (user_id, creator_id, code, account_created_at) values (auth.uid(), gen_random_uuid(), 'X', now())$q$, 'row-level security|violates');
select expect_error('user cannot run jobs', $q$select creator_mark_qualified()$q$, 'permission denied');
select expect_error('user cannot record purchases', $q$select creator_record_transaction('e', array['x'], now(), 'p', 1, 1, 'USD', 0, 0.15, null)$q$, 'permission denied');
select t('user is not a creator', creator_dashboard() is null);

select as_user('20000000-0000-0000-0000-000000000002');
select t('existing account refused', redeem_creator_code('SARAHC')->>'reason' = 'existing_account');
select t('unknown code refused', redeem_creator_code('NOPE123')->>'reason' = 'unknown_code');
select t('other user sees no referral', (select count(*) from referrals) = 0);

select as_user('a0000000-0000-0000-0000-000000000001');
-- Sarah's account is 60 days old, so own_code is checked before the age rule.
select t('own code refused', redeem_creator_code('SARAHC')->>'reason' = 'own_code');
reset role;
set role anon;
select t('share page shows first name', creator_public_name('sarah') = 'Sarah');
select t('share page knows old codes', creator_public_name('SARAHC') = 'Sarah');
select t('share page unknown code', creator_public_name('NOPE') is null);
reset role;
set role authenticated;

select as_user('30000000-0000-0000-0000-000000000003');
select t('u3 redeems', (redeem_creator_code('SARAHC')->>'ok')::boolean);
select as_user('40000000-0000-0000-0000-000000000004');
select t('u4 redeems mike', (redeem_creator_code('MIKE')->>'ok')::boolean);
reset role;

-- ---- Qualifying signups and the $1 bonus ---------------------------------------------
-- u1 (Toronto, offset 300): meals on 3 local days. The third "day" meal is at 02:00 UTC,
-- which is the previous evening locally, so it only counts once the 4th day is logged.
insert into meals (user_id, created_at, ts, status, analysis_json)
select '10000000-0000-0000-0000-000000000001', now(), (extract(epoch from x.t) * 1000)::bigint, x.s, x.a
from (values
  (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 day 15 hours', 'done', '{"estimated_ranges":{}}'::jsonb),
  (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '2 days 15 hours', 'done', '{"estimated_ranges":{}}'::jsonb),
  (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '3 days 2 hours', 'done', '{"estimated_ranges":{}}'::jsonb),
  (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '3 days 15 hours', 'done', '{"estimated_ranges":{},"source":"supplement"}'::jsonb),
  (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '3 days 16 hours', 'failed', '{"estimated_ranges":{}}'::jsonb),
  (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '3 days 17 hours', 'done', null)
) as x(t, s, a);
-- Pretend the meals happened: shift the account and referral back 5 days.
update auth.users set created_at = created_at - interval '5 days' where id = '10000000-0000-0000-0000-000000000001';
update referrals set account_created_at = account_created_at - interval '5 days' where user_id = '10000000-0000-0000-0000-000000000001';
update meals set ts = ts - 5 * 86400000 where user_id = '10000000-0000-0000-0000-000000000001';

set role service_role;
select t('two local days is not enough', creator_mark_qualified() = 0);
reset role;
insert into meals (user_id, ts, status, analysis_json)
values ('10000000-0000-0000-0000-000000000001',
        (extract(epoch from (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '1 day' + interval '18 hours')) * 1000)::bigint,
        'done', '{"estimated_ranges":{}}');
set role service_role;
select t('third local day qualifies', creator_mark_qualified() = 1);
select t('rerun marks nothing new', creator_mark_qualified() = 0);
reset role;
select t('first qualified signup unlocks 3 months of Pro', (select code from creator_pro_codes
  where kind = '3_months' and creator_id = (select id from creators where code = 'SARAHC')) = 'THREE1');
select t('direct deletes did nothing', (select count(*) from creator_codes) = 3);
select t('bonus is $1 CAD', (select amount = 1 and currency = 'CAD' from creator_earnings where kind = 'bonus'));
select t('one bonus only', (select count(*) from creator_earnings where kind = 'bonus') = 1);

-- Cap: Sarah already has $99.50 of bonuses, so the next one is 50 cents, then nothing.
insert into creator_earnings (creator_id, kind, source_id, occurred_at, amount, currency)
select id, 'bonus', 'bonus:filler', now(), 98.5, 'CAD' from creators where code = 'SARAHC';
insert into meals (user_id, ts, status, analysis_json)
select '30000000-0000-0000-0000-000000000003', (extract(epoch from now() + g * interval '1 day') * 1000)::bigint, 'done', '{"estimated_ranges":{}}'
from generate_series(0, 2) g;
set role service_role;
select t('u3 qualifies', creator_mark_qualified() = 1);
reset role;
select t('later qualified signups give no extra 3-month code', (select count(*) from creator_pro_codes
  where kind = '3_months' and creator_id = (select id from creators where code = 'SARAHC')) = 1);
select t('bonus capped at $100', (select sum(amount) from creator_earnings where kind = 'bonus'
  and creator_id = (select id from creators where code = 'SARAHC')) = 100);

-- Bonus window: Mike joined 40 days ago, so u4 qualifies but earns no bonus.
update creators set joined_at = now() - interval '40 days' where code = 'MIKE';
insert into meals (user_id, ts, status, analysis_json)
select '40000000-0000-0000-0000-000000000004', (extract(epoch from now() + g * interval '1 day') * 1000)::bigint, 'done', '{"estimated_ranges":{}}'
from generate_series(0, 2) g;
set role service_role;
select t('u4 qualifies', creator_mark_qualified() = 1);
reset role;
select t('mike unlocks his 3 months too', (select code from creator_pro_codes
  where kind = '3_months' and creator_id = (select id from creators where code = 'MIKE')) = 'THREE2');
select t('no bonus after first 30 days', (select count(*) from creator_earnings e join creators c on c.id = e.creator_id where c.code = 'MIKE') = 0);

-- ---- Purchases -----------------------------------------------------------------------
set role service_role;
select t('non-referred user ignored', creator_record_transaction('ev0', array['20000000-0000-0000-0000-000000000002'], now(), 'com.dillonpoulin.whatyouate.monthly', 12.99, 12.99, 'USD', 0, 0.15, 1.38) = 'not_referred');
select t('free trial ignored', creator_record_transaction('ev0b', array['10000000-0000-0000-0000-000000000001'], now(), 'com.dillonpoulin.whatyouate.monthly', 0, 0, 'CAD', 0, 0.15, 1.38) = 'zero_price');
select t('CAD purchase earns commission', creator_record_transaction('ev1', array['x', '10000000-0000-0000-0000-000000000001'], now() - interval '1 day', 'com.dillonpoulin.whatyouate.monthly', 12.99, 17.99, 'CAD', 0.13, 0.15, 1.38) = 'commission');
select t('duplicate event ignored', creator_record_transaction('ev1', array['10000000-0000-0000-0000-000000000001'], now(), 'com.dillonpoulin.whatyouate.monthly', 12.99, 17.99, 'CAD', 0.13, 0.15, 1.38) = 'duplicate');
reset role;
select t('commission is 30% of Apple proceeds in CAD', (select round(amount, 4) = round(17.99 * 0.87 * 0.85 * 0.30, 4) from creator_earnings where source_id = 'ev1'));
select t('first payment recorded', (select first_paid_at is not null from referrals where user_id = '10000000-0000-0000-0000-000000000001'));
set role service_role;
select t('USD payment converted for CAD creator', creator_record_transaction('ev2', array['30000000-0000-0000-0000-000000000003'], now(), 'com.dillonpoulin.whatyouate.yearly', 109.99, 109.99, 'USD', 0, 0.15, 1.38) = 'commission');
select t('CAD payment uses USD price for USD creator', creator_record_transaction('ev3', array['40000000-0000-0000-0000-000000000004'], now(), 'com.dillonpoulin.whatyouate.monthly', 12.99, 17.99, 'CAD', 0.13, 0.15, 1.38) = 'commission');
select expect_error('other currency needs a rate', $q$select creator_record_transaction('ev4', array['10000000-0000-0000-0000-000000000001'], now(), 'm', 13.5, 12.49, 'EUR', 0.2, 0.15, null)$q$, 'missing_fx_rate');
select t('renewal after 12 months ignored', creator_record_transaction('ev5', array['10000000-0000-0000-0000-000000000001'], now() + interval '12 months 1 day', 'com.dillonpoulin.whatyouate.monthly', 12.99, 17.99, 'CAD', 0.13, 0.15, 1.38) = 'past_12_months');
select t('refund reverses commission', creator_record_transaction('ev6', array['10000000-0000-0000-0000-000000000001'], now(), 'com.dillonpoulin.whatyouate.monthly', -12.99, -17.99, 'CAD', 0.13, 0.15, 1.38) = 'refund');
reset role;
select t('USD to CAD conversion', (select round(amount, 4) = round(109.99 * 1.38 * 0.85 * 0.30, 4) from creator_earnings where source_id = 'ev2'));
select t('USD creator uses USD price', (select round(amount, 4) = round(12.99 * 0.87 * 0.85 * 0.30, 4) from creator_earnings where source_id = 'ev3'));
select t('refund is negative', (select amount < 0 from creator_earnings where source_id = 'ev6'));
select t('refund cancels the commission', (select abs(sum(amount)) < 0.0001 from creator_earnings where source_id in ('ev1', 'ev6')));

-- ---- Dashboard -----------------------------------------------------------------------
set role authenticated;
select as_user('a0000000-0000-0000-0000-000000000001');
select t('dashboard has every section', (select creator_dashboard() ?& array['creator', 'month', 'allTime', 'nextPayout', 'recurring', 'statement', 'weekly']));
select t('dashboard counts code uses this month', (select (creator_dashboard()->'month'->>'codeUses')::int = 2));
select t('dashboard counts paid subscribers', (select (creator_dashboard()->'allTime'->>'paidSubs')::int = 2));
select t('dashboard has 5 weeks', (select jsonb_array_length(creator_dashboard()->'weekly') = 5));
select t('dashboard lists the old code', (select creator_dashboard()->'creator'->'oldCodes' = '["SARAH"]'::jsonb));
select t('recurring skips the refunded subscriber', (select (creator_dashboard()->'recurring'->>'active')::int = 1));
select t('recurring spreads the yearly plan over 12 months', (select (creator_dashboard()->'recurring'->>'monthly')::numeric = round(109.99 * 1.38 * 0.85 * 0.30 / 12, 2)));
select t('dashboard never exposes user ids', (select creator_dashboard()::text !~ '10000000-0000'));
reset role;

-- A third creator joins with the pool empty: joining still works, just no code yet.
insert into auth.users (id, email, created_at) values ('c0000000-0000-0000-0000-000000000003', 'jess@example.com', now() - interval '60 days');
set role authenticated;
select as_user('c0000000-0000-0000-0000-000000000003');
select t('joins with an empty pool', (select code from creator_join('Jess', 'jess', '', 'JESS', 'OTHER', 'paypal', 'jess@example.com')) = 'JESS');
select t('no code while the pool is empty', (creator_dashboard()->'pro'->>'threeMonths') is null);
reset role;
set role service_role;
select t('backfill with empty pool does nothing', creator_backfill_pro_codes() = 0);
select creator_add_pro_codes('3_months', array['THREE3']);
select t('backfill skips creators with no qualified signup', creator_backfill_pro_codes() = 0);
reset role;
insert into referrals (creator_id, code, account_created_at, qualified_at)
select id, 'JESS', now(), now() from creators where code = 'JESS';
set role service_role;
select t('backfill hands out the new code', creator_backfill_pro_codes() = 1);
select t('backfill only once', creator_backfill_pro_codes() = 0);
reset role;
set role authenticated;
select as_user('c0000000-0000-0000-0000-000000000003');
select t('jess now has her code', (creator_dashboard()->'pro'->>'threeMonths') = 'THREE3');
select t('next payout says which month it covers', (creator_dashboard()->'nextPayout'->>'covers') is not null);
reset role;

-- The free year: a referral counts after 2 paid months or a yearly plan, net of refunds.
-- Sarah has u3 (yearly, counts) and u1 (refunded, doesn't). u6 and u7 pay monthly.
select as_user('60000000-0000-0000-0000-000000000006');
set role authenticated;
select t('u6 redeems', (redeem_creator_code('SARAHC')->>'ok')::boolean);
select as_user('70000000-0000-0000-0000-000000000007');
select t('u7 redeems', (redeem_creator_code('SARAHC')->>'ok')::boolean);
reset role;
-- Free month tracking: u7 (Sarah's code, not yet paying) starts and cancels a trial.
select as_user(null);
set role service_role;
select t('trial start recorded', creator_record_trial(array['70000000-0000-0000-0000-000000000007'], 'start', now() + interval '30 days') = 'trial_start');
select t('trial for non-referred user ignored', creator_record_trial(array['20000000-0000-0000-0000-000000000002'], 'start', now() + interval '30 days') = 'not_referred');
reset role;
set role authenticated;
select as_user('a0000000-0000-0000-0000-000000000001');
select t('dashboard counts one in their free month', (creator_dashboard()->>'freeMonth')::int = 1);
reset role;
set role service_role;
select t('trial cancel recorded', creator_record_trial(array['70000000-0000-0000-0000-000000000007'], 'cancel', null) = 'trial_cancel');
reset role;
set role authenticated;
select as_user('a0000000-0000-0000-0000-000000000001');
select t('cancelled free month not counted', (creator_dashboard()->>'freeMonth')::int = 0);
reset role;
set role service_role;
select t('trial uncancel recorded', creator_record_trial(array['70000000-0000-0000-0000-000000000007'], 'uncancel', null) = 'trial_uncancel');
select t('paid users are not in a trial', creator_record_trial(array['30000000-0000-0000-0000-000000000003'], 'cancel', null) = 'not_in_trial');
reset role;

set role service_role;
select creator_record_transaction('ev7', array['60000000-0000-0000-0000-000000000006'], now(), 'com.dillonpoulin.whatyouate.monthly', 12.99, 17.99, 'CAD', 0.13, 0.15, 1.38);
reset role;
select creator_record_transaction('ev8', array['70000000-0000-0000-0000-000000000007'], now(), 'com.dillonpoulin.whatyouate.monthly.creator', 12.99, 17.99, 'CAD', 0.13, 0.15, 1.38);
select creator_record_transaction('ev7b', array['60000000-0000-0000-0000-000000000006'], now() + interval '1 month', 'com.dillonpoulin.whatyouate.monthly', 12.99, 17.99, 'CAD', 0.13, 0.15, 1.38);
reset role;
select t('one month each is not enough', (select count(*) from creator_pro_codes where kind = '1_year' and creator_id is not null) = 0);
set role authenticated;
select as_user('a0000000-0000-0000-0000-000000000001');
select t('progress counts yearly plus 2-month payer', (creator_dashboard()->'pro'->>'paying')::int = 2);
reset role;
set role service_role;
select creator_record_transaction('ev8b', array['70000000-0000-0000-0000-000000000007'], now() + interval '1 month', 'com.dillonpoulin.whatyouate.monthly.creator', 12.99, 17.99, 'CAD', 0.13, 0.15, 1.38);
reset role;
set role authenticated;
select as_user('a0000000-0000-0000-0000-000000000001');
select t('third payer unlocks the year', (creator_dashboard()->'pro'->>'year') = 'YEAR1');
select t('paying follower leaves the free month count', (creator_dashboard()->>'freeMonth')::int = 0);
select t('dashboard counts 3 paying', (creator_dashboard()->'pro'->>'paying')::int = 3);
reset role;
select jsonb_pretty(creator_dashboard()) from (select as_user('a0000000-0000-0000-0000-000000000001')) x;

-- ---- Payouts -------------------------------------------------------------------------
-- Move Sarah's earnings into a known month: all of them in October.
update creator_earnings set occurred_at = '2026-10-15 12:00-04'
where creator_id = (select id from creators where code = 'SARAHC');
update creator_earnings set occurred_at = '2026-10-15 12:00-04'
where creator_id = (select id from creators where code = 'MIKE');
set role service_role;
select t('nothing due Nov 1 for October', (select count(*) from creator_create_payouts('2026-11-01')) = 0);
select t('October paid Dec 1', (select count(*) from creator_create_payouts('2026-12-01')) = 1);
select t('rerun creates nothing', (select count(*) from creator_create_payouts('2026-12-01')) = 0);
reset role;
select t('sarah is owed her October total',
  (select p.amount = round((select sum(amount) from creator_earnings e where e.creator_id = p.creator_id), 2)
   from creator_payouts p join creators c on c.id = p.creator_id where c.code = 'SARAHC'));
select t('mike under $10 rolls over', (select count(*) from creator_payouts p join creators c on c.id = p.creator_id where c.code = 'MIKE') = 0);

-- ---- Leaving -------------------------------------------------------------------------
set role authenticated;
select as_user('b0000000-0000-0000-0000-000000000002');
select expect_error('country fixed once earning', $q$select creator_update_profile('Mike','','','CA','etransfer','m@x.com')$q$, 'country_locked');
select t('profile update works', (select payout_method from creator_update_profile('Mike B', '', 'mikeeats', 'US', 'paypal', 'mike@paypal.com')) = 'paypal');
select creator_leave();
select expect_error('left creator cannot edit', $q$select creator_update_profile('Mike','','','US','paypal','m@x.com')$q$, 'not_a_creator');
select as_user('50000000-0000-0000-0000-000000000005');
select t('left creator code stops working', redeem_creator_code('MIKE')->>'reason' = 'inactive_code');
select t('share page hides left creators', creator_public_name('MIKE') is null);
reset role;
set role service_role;
select t('left creator paid with no minimum', (select count(*) from creator_create_payouts('2027-01-01')) = 1);
reset role;
select t('mike is paid his small balance', (select p.amount < 10 from creator_payouts p join creators c on c.id = p.creator_id where c.code = 'MIKE'));

-- ---- Account deletion ----------------------------------------------------------------
delete from auth.users where id = '10000000-0000-0000-0000-000000000001';
select t('deleting a user keeps the referral count', (select count(*) from referrals where user_id is null and code = 'SARAH') = 1);
select t('earnings survive deletion', (select count(*) from creator_earnings where source_id = 'ev1') = 1);

-- ---- Code expiry ---------------------------------------------------------------------
insert into auth.users (id, email, created_at) values ('d0000000-0000-0000-0000-000000000004', 'dana@example.com', now() - interval '60 days');
set role service_role;
select creator_add_pro_codes('3_months', array['SOON1'], current_date + 5);
select creator_add_pro_codes('3_months', array['LATER1'], current_date + 60);
reset role;
set role authenticated;
select as_user('d0000000-0000-0000-0000-000000000004');
select creator_join('Dana', 'dana', '', 'DANA', 'US', 'paypal', 'dana@example.com');
reset role;
select t('nearly expired code skipped, soonest usable code used',
  creator_assign_pro_code((select id from creators where code = 'DANA'), '3_months') = 'LATER1');
select t('expiry recorded', (select expires_on = current_date + 60 from creator_pro_codes where code = 'LATER1'));

-- ---- Owner page and statements ---------------------------------------------------------
insert into auth.users (id, email) values ('e0000000-0000-0000-0000-000000000099', 'Owner@Example.com');
insert into creator_owners values ('owner@example.com');
create temp table sp as select p.id from creator_payouts p join creators c on c.id = p.creator_id where c.code = 'SARAHC';
create temp table mp as select p.id from creator_payouts p join creators c on c.id = p.creator_id where c.code = 'MIKE';
create temp table n as select count(*) as creators from creators;
grant select on sp, mp, n to authenticated;
set role authenticated;
select as_user('a0000000-0000-0000-0000-000000000001');
select t('a creator is not an owner', not creator_is_owner());
select expect_error('creators cannot see the owner page', $q$select owner_overview()$q$, 'not_owner');
select expect_error('creators cannot mark payouts', $q$select owner_set_payout((select id from sp), 'paid')$q$, 'not_owner');
select t('no statements before a payout is paid', jsonb_array_length(creator_statements()) = 0);
select as_user(null);
select t('signed out is not an owner', not creator_is_owner());
select as_user('e0000000-0000-0000-0000-000000000099');
select t('owner recognised, email case ignored', creator_is_owner());
select t('overview lists every creator', jsonb_array_length(owner_overview()->'creators') = (select creators from n));
select t('due payouts sort first', owner_overview()->'creators'->0->'payout'->>'status' = 'due');
select t('overview has pro code counts', owner_overview()->'proCodes' ? 'threeMonths');
select t('withhold', owner_set_payout((select id from sp), 'withheld')->>'status' = 'withheld');
select t('back to due', owner_set_payout((select id from sp), 'due')->>'status' = 'due');
select expect_error('unknown status refused', $q$select owner_set_payout((select id from sp), 'sent')$q$, 'bad_status');
select t('mark paid', owner_set_payout((select id from sp), 'paid', '  ETR-123 ')->>'status' = 'paid');
select expect_error('a paid payout cannot change', $q$select owner_set_payout((select id from sp), 'due')$q$, 'already_paid');
reset role;
select t('statement frozen with reference and time',
  (select statement is not null and reference = 'ETR-123' and paid_at is not null and paid_on is not null from creator_payouts where id = (select id from sp)));
select t('statement amount is the payout', (select (statement->'payout'->>'amount')::numeric = amount from creator_payouts where id = (select id from sp)));
select t('statement ends with October', (select statement->'months'->-1->>'month' = '2026-10' from creator_payouts where id = (select id from sp)));
select t('statement months add up to the payout',
  (select round(sum((m->>'bonus')::numeric + (m->>'commission')::numeric), 2) from creator_payouts, jsonb_array_elements(statement->'months') m
   where id = (select id from sp)) = (select amount from creator_payouts where id = (select id from sp)));
select t('statement paid out includes this payout',
  (select (statement->'allTime'->>'paidOut')::numeric = amount from creator_payouts where id = (select id from sp)));
-- A payout marked paid outside the owner page still gets a statement, built on the fly.
update creator_payouts set status = 'paid', paid_on = '2027-01-03' where id = (select id from mp);
set role authenticated;
select as_user('a0000000-0000-0000-0000-000000000001');
select t('sarah sees her one statement', jsonb_array_length(creator_statements()) = 1);
select t('her statement carries the reference', creator_statements()->0->'payout'->>'reference' = 'ETR-123');
select as_user('b0000000-0000-0000-0000-000000000002');
select t('mike gets a statement built on the fly', (creator_statements()->0->'payout'->>'amount')::numeric > 0);
select expect_error('creators cannot build snapshots directly', $q$select creator_statement_snapshot((select id from sp))$q$, 'permission denied');
reset role;

-- ---- Owner: months, notes, returned payouts, removing, export ---------------------------
create temp table pc as select count(*) as payouts from creator_payouts;
create temp table ids as select code, id from creators;
grant select on pc, ids to authenticated;
insert into creator_emails (kind, ref, creator_id, to_email)
select 'payout', id::text, creator_id, 'sarah@example.com' from creator_payouts where id = (select id from sp);
set role authenticated;
select as_user('e0000000-0000-0000-0000-000000000099');
select t('october shows sarah''s october earnings',
  (select (c->>'earned')::numeric > 0 from jsonb_array_elements(owner_overview('2026-10-01')->'creators') c where c->>'code' = 'SARAHC'));
select t('september shows nothing earned',
  (select (c->>'earned')::numeric = 0 from jsonb_array_elements(owner_overview('2026-09-01')->'creators') c where c->>'code' = 'SARAHC'));
select t('december shows the payout worked out in december',
  (select c->'payout'->>'dueOn' = '2026-12-01' from jsonb_array_elements(owner_overview('2026-12-01')->'creators') c where c->>'code' = 'SARAHC'));
select t('october has no payout for sarah',
  (select c->'payout' = 'null'::jsonb from jsonb_array_elements(owner_overview('2026-10-01')->'creators') c where c->>'code' = 'SARAHC'));
select t('owed is all time in any month',
  (select (c->>'owed')::numeric = 0 from jsonb_array_elements(owner_overview('2026-09-01')->'creators') c where c->>'code' = 'SARAHC'));
select t('months list ends with this month', owner_overview()->'months'->>0 = to_char(now() at time zone 'America/Toronto', 'YYYY-MM'));
select owner_update_creator((select id from ids where code = 'SARAHC'), 'Met at the clinic. Posting Friday.', true);
select t('notes and posted saved',
  (select c->>'notes' = 'Met at the clinic. Posting Friday.' and (c->>'posted')::boolean from jsonb_array_elements(owner_overview()->'creators') c where c->>'code' = 'SARAHC'));
select t('export has every payout', jsonb_array_length(owner_export()) = (select payouts from pc));
select expect_error('only paid payouts reopen', $q$select owner_reopen_payout((select id from creator_payouts limit 0))$q$, 'no_payout');
select t('returned payout goes back to due', owner_reopen_payout((select id from sp))->>'status' = 'due');
select expect_error('a due payout cannot be returned', $q$select owner_reopen_payout((select id from sp))$q$, 'not_paid');
select as_user('a0000000-0000-0000-0000-000000000001');
select t('a creator cannot read owner notes', (select count(*) from creator_owner_notes) = 0);
select expect_error('a creator cannot write owner notes', $q$select owner_update_creator((select id from sp), 'x', false)$q$, 'not_owner');
select t('the returned statement is withdrawn', jsonb_array_length(creator_statements()) = 0);
select as_user('e0000000-0000-0000-0000-000000000099');
select t('remove sarah', owner_set_creator_status((select id from ids where code = 'SARAHC'), 'removed', true) = 'removed');
select expect_error('only removed creators restore', $q$select owner_set_creator_status((select id from ids where code = 'DANA'), 'active')$q$, 'not_removed');
reset role;
select t('returned payout is marked, reopened and its email can go again',
  (select returned_at is not null and paid_on is null and statement is null and reference = 'Returned: ETR-123' from creator_payouts where id = (select id from sp))
  and not exists (select 1 from creator_emails where kind = 'payout' and ref = (select id::text from sp)));
select t('removing withholds the waiting payout', (select status = 'withheld' from creator_payouts where id = (select id from sp)));
set role authenticated;
select as_user('50000000-0000-0000-0000-000000000005');
select t('a removed creator''s code stops working', redeem_creator_code('SARAHC')->>'reason' = 'inactive_code');
select as_user('e0000000-0000-0000-0000-000000000099');
select t('restore sarah', owner_set_creator_status((select id from ids where code = 'SARAHC'), 'active') = 'active');
reset role;
select t('restored creator is active again', (select status = 'active' and left_at is null from creators where code = 'SARAHC'));

\echo ALL TESTS PASSED
