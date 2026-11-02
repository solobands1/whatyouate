\set ON_ERROR_STOP on
-- Run after setup.sql, creators.sql, tests.sql and creators_house.sql (see README).
select t('house account exists with ENERGY', exists (select 1 from creators c join creator_codes cc on cc.creator_id = c.id
  where c.is_house and c.code = 'ENERGY' and cc.code = 'ENERGY' and c.status = 'active'));
select t('welcome and nudge emails marked sent', (select count(*) from creator_emails e join creators c on c.id = e.creator_id
  where c.is_house and e.kind in ('welcome', 'nudge')) = 2);
select t('share page name is WhatYouAte', creator_public_name('energy') = 'WhatYouAte');

insert into auth.users (id, email, created_at) values ('90000000-0000-0000-0000-000000000009', 'h1@example.com', now() - interval '1 hour');
insert into public.profiles (user_id, timezone_offset_minutes) values ('90000000-0000-0000-0000-000000000009', 300);
set role authenticated;
select as_user('90000000-0000-0000-0000-000000000009');
select t('new user redeems ENERGY', (redeem_creator_code('energy')->>'ok')::boolean);
reset role;

-- Meals on 3 local days, then pretend it all happened 5 days ago.
insert into meals (user_id, ts, status, analysis_json)
select '90000000-0000-0000-0000-000000000009', (extract(epoch from x.t) * 1000)::bigint, 'done', '{"estimated_ranges":{}}'::jsonb
from (values (now() + interval '1 hour'), (now() + interval '1 day 1 hour'), (now() + interval '2 days 1 hour')) as x(t);
update auth.users set created_at = created_at - interval '5 days' where id = '90000000-0000-0000-0000-000000000009';
update referrals set account_created_at = account_created_at - interval '5 days', redeemed_at = redeemed_at - interval '5 days'
  where user_id = '90000000-0000-0000-0000-000000000009';
update meals set ts = ts - 5 * 86400000 where user_id = '90000000-0000-0000-0000-000000000009';

set role service_role;
select t('house signup qualifies', creator_mark_qualified() >= 1);
reset role;
select t('house signup is marked qualified', (select qualified_at is not null from referrals where user_id = '90000000-0000-0000-0000-000000000009'));
select t('house earns no bonus', not exists (select 1 from creator_earnings e join creators c on c.id = e.creator_id where c.is_house));
select t('house gets no free Pro code', not exists (select 1 from creator_pro_codes p join creators c on c.id = p.creator_id where c.is_house));

set role service_role;
select t('house purchase recorded without commission', creator_record_transaction('hev1', array['90000000-0000-0000-0000-000000000009'],
  now() - interval '40 days', 'com.dillonpoulin.whatyouate.monthly', 12.99, 17.99, 'CAD', 0.13, 0.15, 1.38) = 'house');
reset role;
select t('house paying subscriber is counted', (select first_paid_at is not null from referrals where user_id = '90000000-0000-0000-0000-000000000009'));
select t('still no house earnings', not exists (select 1 from creator_earnings e join creators c on c.id = e.creator_id where c.is_house));
set role service_role;
select creator_backfill_pro_codes();
select creator_create_payouts((date_trunc('month', now()) + interval '1 month')::date);
reset role;
select t('house never gets a payout', not exists (select 1 from creator_payouts p join creators c on c.id = p.creator_id where c.is_house));
select t('backfill skips house', not exists (select 1 from creator_pro_codes p join creators c on c.id = p.creator_id where c.is_house));

set role authenticated;
select as_user('e0000000-0000-0000-0000-000000000099');
select t('owner page shows the house row with its numbers', exists (
  select 1 from jsonb_array_elements(owner_overview()->'creators') x
  where (x->>'house')::boolean and x->>'code' = 'ENERGY' and (x->>'codeUses')::int = 1 and (x->>'signups')::int = 1 and (x->>'paying')::int = 1));
create temp table house_rep as select (owner_report()->>'creatorsActive')::int as active;
reset role;
select t('report counts exclude house', (select active from house_rep) = (select count(*) from creators where status = 'active' and not is_house)
  and (select active from house_rep) < (select count(*) from creators where status = 'active'));
\echo HOUSE TESTS PASSED
