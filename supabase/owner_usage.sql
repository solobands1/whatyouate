-- App usage for the owner (whatyouate.app/creators/owner/usage): how many people use the app, where each one is in
-- the funnel, when they last logged, and where people drop off.
--
-- Additive only. It adds two small tables (user_subscription_status, usage_internal_users) and read functions. No
-- existing table, column or function is changed, so running it cannot change how the app behaves. Safe to rerun.
--
-- Where each funnel step comes from (nothing new is recorded for these; they are read from what the app already saves):
--   1 Signed Up            auth.users.created_at
--   2 Finished Onboarding  profiles.onboarding_done (written by components/OnboardingFlow.tsx on its last screen). Older
--                          accounts that logged a meal count too, in case they predate that column.
--   3 Logged A Meal        meals: a real meal as lib/trial.ts counts it (not failed, not a supplement). The meal's moment
--                          is meals.ts (ms) when set, otherwise created_at, as in lib/supabaseDb.ts.
--   4 Did A Check-In       profiles.reflections_json: the nightly reflection, one entry per local day {date, ts, ...}.
--   5 Came Back Next Day   anything on a second local day: meals, supplements, check-ins, energy taps (feel_logs), water
--                          (profiles.water_logs_json), workouts, weight, or an Apple Health sync (step_logs / sleep_logs
--                          synced_at, which the app writes each time it opens with Health connected).
--   6 Built Their Picture  the "core picture" from lib/trial.ts: 5 real meals on 5 different local days. The free window
--                          then runs 2 more days, or ends 14 days after the first meal, whichever comes first.
--   7 Started Apple Trial  user_subscription_status (fed by the RevenueCat webhook from now on, plus a one-off backfill),
--                          or referrals.trial_ends_at for creator-code users. Buying straight away counts here too.
--   8 Paying               user_subscription_status.first_paid_at, or referrals.first_paid_at.
-- Each person is placed at the furthest step they've reached, and each bar counts everyone at that step or beyond, so the
-- bars only ever go down. Nobody gets past step 3 without logging a meal. Steps 4 to 8 don't have to happen in order (a
-- daily logger may never do a check-in), so each step also reports how many actually did that thing.
--
-- Local days use profiles.timezone_offset_minutes (minutes behind UTC, like JS getTimezoneOffset; 300 if unknown),
-- the same way creator_mark_qualified in creators.sql does. Signups by day use Toronto time.
--
-- Left out of every count: test and staff accounts (usage_internal_users, plus anyone in creator_owners), and accounts
-- made on the creator website that never opened the app (a creators row and no app data at all).
--
-- Every owner_* function checks creator_is_owner() from creators.sql, so run creators.sql first. The helper functions
-- are not callable by anyone but the database owner.

-- ---- Subscription status (from RevenueCat) ---------------------------------------------------------------------------
-- The app checks RevenueCat live and never stored the result. The webhook (app/api/creators/revenuecat/route.ts) now
-- writes each user's latest state here through usage_record_subscription, and scripts/backfill-subscription-status.mjs
-- fills it in once for everyone. No row means RevenueCat has never seen a purchase or trial for that person.
create table if not exists public.user_subscription_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('free_window', 'trial', 'subscribed', 'cancelled_active', 'expired', 'billing_issue')),
  product_id text,
  period_type text,             -- TRIAL, INTRO, NORMAL (RevenueCat's period type, upper case)
  expires_at timestamptz,
  will_renew boolean,
  store text,
  updated_at timestamptz not null default now(),
  last_event_type text,         -- the RevenueCat event that set this row, or BACKFILL
  last_event_at timestamptz,    -- when that event happened, so an older event arriving late never overwrites a newer one
  trial_started_at timestamptz, -- first time a free trial started (kept when the trial ends)
  first_paid_at timestamptz     -- first paid period seen (kept after cancelling)
);
alter table public.user_subscription_status enable row level security;
-- No policies: only the service role and the functions below read or write it.

-- Accounts left out of the numbers. Seeded with the accounts lib/trial.ts gives unlimited access.
create table if not exists public.usage_internal_users (
  user_id uuid primary key,
  note text not null default '',
  added_at timestamptz not null default now()
);
alter table public.usage_internal_users enable row level security;
insert into public.usage_internal_users (user_id, note) values
  ('4ef35614-32ec-4a17-b410-f4c31437c1bc', 'Dillon'),
  ('b2d6d7a6-a147-4dfb-9750-375d070cccbf', 'Andrea'),
  ('973c0886-cd6f-4813-8a3c-4ded80bfa09c', 'Apple review demo'),
  ('cb1b1885-8192-4a71-ad64-30c58905c5d1', 'Marketing demo')
on conflict (user_id) do nothing;

-- Records one RevenueCat state for a user (service role only: the webhook and the backfill). An event older than the one
-- already stored only fills in trial_started_at / first_paid_at; it never rolls the status back.
create or replace function public.usage_record_subscription(
  p_user_id uuid, p_status text, p_product_id text, p_period_type text, p_expires_at timestamptz,
  p_will_renew boolean, p_store text, p_event_type text, p_event_at timestamptz,
  p_trial_started_at timestamptz default null, p_first_paid_at timestamptz default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  at timestamptz := coalesce(p_event_at, now());
begin
  if p_status not in ('free_window', 'trial', 'subscribed', 'cancelled_active', 'expired', 'billing_issue') then
    return 'bad_status';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then return 'unknown_user'; end if;
  insert into user_subscription_status as s (user_id, status, product_id, period_type, expires_at, will_renew, store,
    updated_at, last_event_type, last_event_at, trial_started_at, first_paid_at)
  values (p_user_id, p_status, p_product_id, upper(p_period_type), p_expires_at, p_will_renew, p_store,
    now(), p_event_type, at, p_trial_started_at, p_first_paid_at)
  on conflict (user_id) do update set
    status = case when s.last_event_at is null or excluded.last_event_at >= s.last_event_at then excluded.status else s.status end,
    product_id = case when s.last_event_at is null or excluded.last_event_at >= s.last_event_at then coalesce(excluded.product_id, s.product_id) else s.product_id end,
    period_type = case when s.last_event_at is null or excluded.last_event_at >= s.last_event_at then coalesce(excluded.period_type, s.period_type) else s.period_type end,
    expires_at = case when s.last_event_at is null or excluded.last_event_at >= s.last_event_at then excluded.expires_at else s.expires_at end,
    will_renew = case when s.last_event_at is null or excluded.last_event_at >= s.last_event_at then excluded.will_renew else s.will_renew end,
    store = coalesce(excluded.store, s.store),
    last_event_type = case when s.last_event_at is null or excluded.last_event_at >= s.last_event_at then excluded.last_event_type else s.last_event_type end,
    last_event_at = greatest(s.last_event_at, excluded.last_event_at),
    trial_started_at = least(s.trial_started_at, excluded.trial_started_at),
    first_paid_at = least(s.first_paid_at, excluded.first_paid_at),
    updated_at = now();
  return 'recorded';
end $$;

-- ---- Row types the helpers pass around ------------------------------------------------------------------------------
-- Everything is worked out once per page load: every activity as an event, then one row of facts per person. If a later
-- version of this file changes these types, they are dropped and rebuilt here (that only drops the usage_* and
-- owner_usage* functions, which are all recreated below).
do $$
declare
  want_event constant text := 'user_id:uuid,at:timestamp with time zone,day:date,kind:text';
  want_fact constant text := 'user_id:uuid,email:text,name:text,signed_up_at:timestamp with time zone,days_since_signup:integer,'
    || 'internal:boolean,site_only:boolean,onboarded:boolean,walkthrough_done:boolean,total_meals:integer,first_meal_at:timestamp with time zone,'
    || 'last_meal_at:timestamp with time zone,meals_today:integer,meals_7d:integer,logs_today:integer,logs_7d:integer,reflections:integer,'
    || 'reflected_today:boolean,active_days:integer,active_today:boolean,last_activity_at:timestamp with time zone,core_at:timestamp with time zone,'
    || 'free_ends_at:timestamp with time zone,s_onboarded:boolean,s_meal:boolean,s_reflected:boolean,s_second_day:boolean,s_core:boolean,'
    || 's_trial:boolean,s_paid:boolean,stage:integer,status:text,product_id:text,period_type:text,expires_at:timestamp with time zone,'
    || 'will_renew:boolean,push_enabled:boolean,platform:text,code:text,flags:text[]';
  have text;
begin
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) into have
  from pg_attribute a where a.attrelid = to_regclass('public.usage_event') and a.attnum > 0 and not a.attisdropped;
  if have is distinct from want_event then
    drop type if exists public.usage_event cascade;
    create type public.usage_event as (user_id uuid, at timestamptz, day date, kind text);
  end if;
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) into have
  from pg_attribute a where a.attrelid = to_regclass('public.usage_fact') and a.attnum > 0 and not a.attisdropped;
  if have is distinct from want_fact then
    drop type if exists public.usage_fact cascade;
    create type public.usage_fact as (
      user_id uuid, email text, name text, signed_up_at timestamptz, days_since_signup integer,
      internal boolean, site_only boolean, onboarded boolean, walkthrough_done boolean,
      total_meals integer, first_meal_at timestamptz, last_meal_at timestamptz, meals_today integer, meals_7d integer,
      logs_today integer, logs_7d integer, reflections integer, reflected_today boolean,
      active_days integer, active_today boolean, last_activity_at timestamptz,
      core_at timestamptz, free_ends_at timestamptz,
      s_onboarded boolean, s_meal boolean, s_reflected boolean, s_second_day boolean, s_core boolean, s_trial boolean, s_paid boolean,
      stage integer, status text, product_id text, period_type text, expires_at timestamptz, will_renew boolean,
      push_enabled boolean, platform text, code text, flags text[]
    );
  end if;
end $$;

-- ---- Helpers ---------------------------------------------------------------------------------------------------------

-- A YYYY-MM-DD string as a date, or null if it isn't a real date (so one bad entry can't break the page).
create or replace function public.usage_safe_date(p text)
returns date language plpgsql immutable as $$
begin
  if p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then
  return null;
end $$;

-- Every logged thing, one row each: who, when, which local day, and what (meal, supplement, reflection, checkin, water,
-- workout, weight, health). The two meal branches repeat the predicates of the recommended partial indexes at the end
-- of this file word for word, so Postgres can read meals from those indexes alone instead of the big analysis_json.
create or replace function public.usage_events()
returns setof public.usage_event language sql stable security definer set search_path = public as $$
  with tz as (
    select user_id, coalesce(timezone_offset_minutes, 300) as tz from profiles
  ),
  timed as (
    select m.user_id,
      case when coalesce(m.ts, 0) > 100000000000 then to_timestamp(m.ts / 1000.0)
           when coalesce(m.ts, 0) > 0 then to_timestamp(m.ts) else m.created_at end as at,
      'meal' as kind
    from meals m
    where coalesce(status, 'done') <> 'failed' and coalesce(analysis_json->>'source', '') <> 'supplement'
    union all
    select m.user_id,
      case when coalesce(m.ts, 0) > 100000000000 then to_timestamp(m.ts / 1000.0)
           when coalesce(m.ts, 0) > 0 then to_timestamp(m.ts) else m.created_at end,
      'supplement'
    from meals m
    where coalesce(status, 'done') <> 'failed' and analysis_json->>'source' = 'supplement'
    union all
    select user_id, case when ts > 100000000000 then to_timestamp(ts / 1000.0) else to_timestamp(ts) end, 'checkin'
    from feel_logs where ts is not null
    union all
    select user_id, created_at, 'workout' from workouts
    union all
    select user_id, logged_at, 'weight' from weight_logs
    union all
    select distinct user_id, synced_at, 'health' from step_logs where synced_at is not null
    union all
    select distinct user_id, synced_at, 'health' from sleep_logs where synced_at is not null
  )
  select t.user_id, t.at, ((t.at at time zone 'UTC') - make_interval(mins => coalesce(z.tz, 300)))::date, t.kind
  from timed t left join tz z on z.user_id = t.user_id
  where t.user_id is not null and t.at is not null
  union all
  -- The nightly reflection, on the local day it's for.
  select p.user_id,
    coalesce(case when e->>'ts' ~ '^[0-9]{10,15}$' then to_timestamp((e->>'ts')::numeric / 1000.0) end,
             (public.usage_safe_date(e->>'date') + time '21:00') at time zone 'UTC' + make_interval(mins => coalesce(p.timezone_offset_minutes, 300))),
    public.usage_safe_date(e->>'date'), 'reflection'
  from profiles p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.reflections_json) = 'array' then p.reflections_json else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'object' and public.usage_safe_date(e->>'date') is not null
  union all
  -- Water: a total per local day ("goal" is a setting, not a log). No time is saved, so it counts as noon that day.
  select p.user_id,
    least(now(), (public.usage_safe_date(w.key) + time '12:00') at time zone 'UTC' + make_interval(mins => coalesce(p.timezone_offset_minutes, 300))),
    public.usage_safe_date(w.key), 'water'
  from profiles p
  cross join lateral jsonb_each(case when jsonb_typeof(p.water_logs_json) = 'object' then p.water_logs_json else '{}'::jsonb end) w
  where public.usage_safe_date(w.key) is not null and jsonb_typeof(w.value) = 'number' and (w.value)::text::numeric > 0
$$;

-- One row of facts per account: where they are in the funnel, their status and their activity.
create or replace function public.usage_facts(p_events public.usage_event[])
returns setof public.usage_fact language sql stable security definer set search_path = public as $$
  with ev as (select * from unnest(p_events)),
  people as (
    select u.id, lower(u.email) as email, u.created_at,
      coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
               nullif(trim(concat_ws(' ', u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'last_name')), ''),
               split_part(lower(u.email), '@', 1)) as name,
      p.user_id is not null as has_profile,
      coalesce(p.onboarding_done, false) as onboarded,
      coalesce(p.walkthrough_done, false) as walkthrough_done,
      ((now() at time zone 'UTC') - make_interval(mins => coalesce(p.timezone_offset_minutes, 300)))::date as today,
      exists (select 1 from usage_internal_users i where i.user_id = u.id)
        or exists (select 1 from creator_owners o where o.email = lower(u.email)) as internal,
      exists (select 1 from creators c where c.user_id = u.id) as is_creator
    from auth.users u
    left join profiles p on p.user_id = u.id
  ),
  act as (
    select e.user_id,
      count(*) filter (where e.kind = 'meal')::int as total_meals,
      min(e.at) filter (where e.kind = 'meal') as first_meal_at,
      max(e.at) filter (where e.kind = 'meal') as last_meal_at,
      (array_agg(e.at order by e.at) filter (where e.kind = 'meal'))[5] as fifth_meal_at,
      count(*) filter (where e.kind = 'meal' and e.day = pe.today)::int as meals_today,
      count(*) filter (where e.kind = 'meal' and e.at >= now() - interval '7 days')::int as meals_7d,
      count(*) filter (where e.kind <> 'health' and e.day = pe.today)::int as logs_today,
      count(*) filter (where e.kind <> 'health' and e.at >= now() - interval '7 days')::int as logs_7d,
      count(*) filter (where e.kind = 'reflection')::int as reflections,
      bool_or(e.kind = 'reflection' and e.day = pe.today) as reflected_today,
      count(distinct e.day)::int as active_days,
      bool_or(e.day = pe.today) as active_today,
      max(least(e.at, now())) as last_activity_at
    from ev e join people pe on pe.id = e.user_id
    group by e.user_id
  ),
  -- The first meal of each local day, for "5 different days".
  meal_days as (
    select user_id, min(at) as first_at from ev where kind = 'meal' group by user_id, day
  ),
  fifth_day as (
    select user_id, (array_agg(first_at order by first_at))[5] as fifth_day_at from meal_days group by user_id
  ),
  push as (
    select user_id, max(platform) as platform from push_tokens group by user_id
  ),
  base as (
    select pe.*, a.*, s.status as sub_status, s.product_id, s.period_type, s.expires_at, s.will_renew,
      s.trial_started_at, s.first_paid_at, r.code, r.trial_ends_at as ref_trial_ends_at, r.first_paid_at as ref_first_paid_at,
      ps.user_id is not null as push_enabled, ps.platform,
      -- Both thresholds are counted in time order, so the picture is built at the later of the two moments.
      case when a.fifth_meal_at is not null and fd.fifth_day_at is not null then greatest(a.fifth_meal_at, fd.fifth_day_at) end as core_at
    from people pe
    left join act a on a.user_id = pe.id
    left join fifth_day fd on fd.user_id = pe.id
    left join user_subscription_status s on s.user_id = pe.id and s.status <> 'free_window'
    left join referrals r on r.user_id = pe.id
    left join push ps on ps.user_id = pe.id
  ),
  steps as (
    select b.*,
      least(b.core_at + interval '2 days', b.first_meal_at + interval '14 days') as free_ends_at,
      b.onboarded or coalesce(b.total_meals, 0) > 0 as s_onboarded,
      coalesce(b.total_meals, 0) > 0 as s_meal,
      coalesce(b.reflections, 0) > 0 as s_reflected,
      coalesce(b.active_days, 0) >= 2 as s_second_day,
      b.core_at is not null as s_core,
      b.sub_status is not null or b.trial_started_at is not null or b.first_paid_at is not null
        or b.ref_trial_ends_at is not null or b.ref_first_paid_at is not null as s_trial,
      b.first_paid_at is not null or b.ref_first_paid_at is not null as s_paid,
      b.is_creator and not b.has_profile and b.user_id is null as site_only
    from base b
  ),
  graded as (
    select st.*,
      -- How far they've got: onboarding and a first meal come first; after that, the furthest step they've reached
      -- (someone logging every day who never did a check-in is past the check-in step, not stuck at it).
      case when not s_onboarded then 1 when not s_meal then 2 when s_paid then 8 when s_trial then 7 when s_core then 6
           when s_second_day then 5 when s_reflected then 4 else 3 end as stage,
      case
        when sub_status is not null then
          case when sub_status in ('trial', 'subscribed', 'cancelled_active') and expires_at < now() then 'expired' else sub_status end
        when coalesce(total_meals, 0) = 0 then 'not_started'
        when free_ends_at <= now() then 'free_ended'
        else 'free_window'
      end as status
    from steps st
  )
  select g.id, g.email, g.name, g.created_at, floor(extract(epoch from now() - g.created_at) / 86400)::int,
    g.internal, g.site_only, g.onboarded, g.walkthrough_done,
    coalesce(g.total_meals, 0), g.first_meal_at, g.last_meal_at, coalesce(g.meals_today, 0), coalesce(g.meals_7d, 0),
    coalesce(g.logs_today, 0), coalesce(g.logs_7d, 0), coalesce(g.reflections, 0), coalesce(g.reflected_today, false),
    coalesce(g.active_days, 0), coalesce(g.active_today, false), g.last_activity_at,
    g.core_at, g.free_ends_at,
    g.s_onboarded, g.s_meal, g.s_reflected, g.s_second_day, g.s_core, g.s_trial, g.s_paid,
    g.stage, g.status, g.product_id, g.period_type, g.expires_at, g.will_renew,
    g.push_enabled, g.platform, g.code,
    case when g.internal or g.site_only then '{}'::text[] else array_remove(array[
      -- Signed up but never finished onboarding.
      case when not g.s_onboarded and g.created_at < now() - interval '1 hour' then 'never_onboarded' end,
      -- Finished onboarding, 3 or more days ago, and still no meal (last 30 days of signups).
      case when g.s_onboarded and not g.s_meal and g.created_at < now() - interval '3 days'
                and g.created_at >= now() - interval '30 days' then 'no_meal_day3' end,
      -- Signed up 7 to 30 days ago, logged a meal on day 7 or later, and again in the last 3 days.
      case when g.created_at < now() - interval '7 days' and g.created_at >= now() - interval '30 days'
                and g.last_meal_at >= g.created_at + interval '6 days' and g.last_meal_at >= now() - interval '3 days' then 'still_logging_day7' end,
      -- Apple trial ends within 2 days (renewing or not) and they used the app in the last 3 days.
      case when (g.status = 'trial' or (g.status = 'cancelled_active' and g.period_type = 'TRIAL'))
                and g.expires_at > now() and g.expires_at <= now() + interval '2 days'
                and g.last_activity_at >= now() - interval '3 days' then 'trial_ending' end,
      -- Paying, and nothing logged for 7 days.
      case when (g.status in ('subscribed', 'billing_issue') or (g.status = 'cancelled_active' and coalesce(g.period_type, '') <> 'TRIAL'))
                and coalesce(g.last_activity_at, '-infinity') < now() - interval '7 days' then 'paying_quiet' end,
      -- Their free window ended in the last 7 days and they didn't start a trial.
      case when g.status = 'free_ended' and g.free_ends_at >= now() - interval '7 days' then 'paywall_no_trial' end
    ], null) end
  from graded g
$$;

-- The facts for everyone, worked out once.
create or replace function public.usage_all_facts()
returns public.usage_fact[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(f), '{}') from public.usage_facts(array(select public.usage_events())) f
$$;

-- Big numbers. People counted are app users who aren't test or staff accounts.
create or replace function public.usage_summary_json(p_facts public.usage_fact[])
returns jsonb language sql stable set search_path = public as $$
  with f as (select * from unnest(p_facts)),
  tor as (select (now() at time zone 'America/Toronto')::date as today),
  c as (select * from f where not internal and not site_only)
  select jsonb_build_object(
    'generatedAt', now(),
    'totalUsers', (select count(*) from c),
    'signupsToday', (select count(*) from c, tor where (signed_up_at at time zone 'America/Toronto')::date = tor.today),
    'signups7d', (select count(*) from c where signed_up_at >= now() - interval '7 days'),
    'signups30d', (select count(*) from c where signed_up_at >= now() - interval '30 days'),
    'activeToday', (select count(*) from c where active_today),
    'active7d', (select count(*) from c where last_activity_at >= now() - interval '7 days'),
    'active30d', (select count(*) from c where last_activity_at >= now() - interval '30 days'),
    'mealsToday', (select coalesce(sum(meals_today), 0) from c),
    'meals7d', (select coalesce(sum(meals_7d), 0) from c),
    'byStatus', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) as n from c group by status) s),
    'internal', (select count(*) from f where internal and not site_only),
    'siteOnly', (select count(*) from f where site_only)
  )
$$;

-- The funnel for people who signed up in the last p_days days (all time when null).
create or replace function public.usage_funnel_json(p_facts public.usage_fact[], p_days integer)
returns jsonb language sql stable set search_path = public as $$
  with c as (
    select * from unnest(p_facts)
    where not internal and not site_only and (p_days is null or signed_up_at >= now() - make_interval(days => p_days))
  ),
  st(n, key, label) as (values
    (1, 'signed_up', 'Signed Up'), (2, 'onboarded', 'Finished Onboarding'), (3, 'first_meal', 'Logged A Meal'),
    (4, 'reflected', 'Did A Check-In'), (5, 'second_day', 'Came Back Next Day'), (6, 'core', 'Built Their Picture'),
    (7, 'trial', 'Started Apple Trial'), (8, 'paid', 'Paying')
  ),
  counts as (
    select st.n, st.key, st.label,
      (select count(*) from c where c.stage >= st.n) as reached,
      (select count(*) from c where case st.n when 1 then true when 2 then s_onboarded when 3 then s_meal when 4 then s_reflected
        when 5 then s_second_day when 6 then s_core when 7 then s_trial else s_paid end) as did
    from st
  ),
  steps as (
    select *, lag(reached) over (order by n) as prev from counts
  )
  select jsonb_build_object(
    'days', p_days,
    'cohort', (select count(*) from c),
    -- Signed up under a week ago: too new to have reached the later steps yet.
    'recent', (select count(*) from c where signed_up_at >= now() - interval '7 days'),
    'stages', (select jsonb_agg(jsonb_build_object(
        'n', n, 'key', key, 'label', label, 'reached', reached, 'didIt', did,
        'lost', coalesce(prev - reached, 0),
        'keptPct', case when prev > 0 then round(100.0 * reached / prev, 1) end,
        'ofStartPct', case when (select reached from counts where n = 1) > 0
                           then round(100.0 * reached / (select reached from counts where n = 1), 1) end
      ) order by n) from steps),
    -- The step where the most people stop (ties go to the earlier step).
    'biggestDrop', (select n from steps where prev - reached > 0 order by prev - reached desc, n limit 1)
  )
$$;

-- Per day for the last p_days days (Toronto dates for signups, each person's own local date for activity).
create or replace function public.usage_daily_json(p_facts public.usage_fact[], p_events public.usage_event[], p_days integer)
returns jsonb language sql stable set search_path = public as $$
  with c as (select user_id, signed_up_at from unnest(p_facts) where not internal and not site_only),
  tor as (select (now() at time zone 'America/Toronto')::date as today),
  days as (select generate_series(tor.today - (greatest(p_days, 1) - 1), tor.today, interval '1 day')::date as d from tor),
  ev as (select e.* from unnest(p_events) e join c on c.user_id = e.user_id where e.day >= (select min(d) from days)),
  signups as (select (signed_up_at at time zone 'America/Toronto')::date as d, count(*) as n from c group by 1),
  act as (
    select day as d, count(distinct user_id) as active, count(*) filter (where kind = 'meal') as meals,
      count(*) filter (where kind = 'reflection') as reflections
    from ev group by day
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', days.d, 'signups', coalesce(s.n, 0), 'active', coalesce(a.active, 0),
    'meals', coalesce(a.meals, 0), 'reflections', coalesce(a.reflections, 0)
  ) order by days.d), '[]'::jsonb)
  from days left join signups s on s.d = days.d left join act a on a.d = days.d
$$;

-- One row per person (website-only creator accounts left out; test and staff accounts included and marked).
create or replace function public.usage_users_json(p_facts public.usage_fact[])
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', user_id, 'name', name, 'email', email, 'signedUpAt', signed_up_at, 'daysSinceSignup', days_since_signup,
    'stage', stage, 'status', status, 'productId', product_id, 'periodType', period_type, 'expiresAt', expires_at,
    'willRenew', will_renew, 'onboarded', onboarded, 'walkthroughDone', walkthrough_done,
    'logsToday', logs_today, 'logs7d', logs_7d, 'mealsToday', meals_today, 'totalMeals', total_meals,
    'firstMealAt', first_meal_at, 'lastMealAt', last_meal_at, 'lastActivityAt', last_activity_at,
    'reflections', reflections, 'reflectedToday', reflected_today, 'activeDays', active_days,
    'coreAt', core_at, 'freeEndsAt', free_ends_at, 'pushEnabled', push_enabled, 'platform', platform,
    'code', code, 'internal', internal, 'flags', to_jsonb(flags)
  ) order by last_activity_at desc nulls last, signed_up_at desc), '[]'::jsonb)
  from unnest(p_facts) where not site_only
$$;

-- ---- Owner functions (each checks creator_is_owner) ------------------------------------------------------------------

-- Everything the usage page shows, in one call: big numbers, the funnel for 7, 30 and 90 days and all time, the last
-- p_days days, and one row per person.
create or replace function public.owner_usage(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ev public.usage_event[];
  f public.usage_fact[];
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  ev := array(select public.usage_events());
  f := array(select public.usage_facts(ev));
  return jsonb_build_object(
    'summary', public.usage_summary_json(f),
    'funnels', jsonb_build_object(
      '7', public.usage_funnel_json(f, 7), '30', public.usage_funnel_json(f, 30),
      '90', public.usage_funnel_json(f, 90), 'all', public.usage_funnel_json(f, null)),
    'daily', public.usage_daily_json(f, ev, least(greatest(coalesce(p_days, 30), 1), 366)),
    'users', public.usage_users_json(f)
  );
end $$;

create or replace function public.owner_usage_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  return public.usage_summary_json(public.usage_all_facts());
end $$;

create or replace function public.owner_usage_funnel(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  return public.usage_funnel_json(public.usage_all_facts(), p_days);
end $$;

create or replace function public.owner_usage_users()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  return public.usage_users_json(public.usage_all_facts());
end $$;

create or replace function public.owner_usage_daily(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ev public.usage_event[];
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  ev := array(select public.usage_events());
  return public.usage_daily_json(array(select public.usage_facts(ev)), ev, least(greatest(coalesce(p_days, 30), 1), 366));
end $$;

-- People to follow up with, grouped by flag (same flags as the users list).
create or replace function public.owner_usage_follow_ups()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  return (
    select coalesce(jsonb_object_agg(flag, people), '{}'::jsonb) from (
      select flag, jsonb_agg(jsonb_build_object('id', user_id, 'name', name, 'email', email, 'signedUpAt', signed_up_at,
        'lastActivityAt', last_activity_at, 'status', status) order by signed_up_at desc) as people
      from unnest(public.usage_all_facts()) f cross join lateral unnest(f.flags) flag
      group by flag
    ) g
  );
end $$;

-- ---- Permissions -----------------------------------------------------------------------------------------------------
-- Supabase grants new functions to anon and authenticated by default, so every helper is locked down explicitly: they
-- read everyone's data and skip the owner check.
revoke all on function public.usage_record_subscription(uuid, text, text, text, timestamptz, boolean, text, text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.usage_safe_date(text) from public, anon, authenticated;
revoke all on function public.usage_events() from public, anon, authenticated;
revoke all on function public.usage_facts(public.usage_event[]) from public, anon, authenticated;
revoke all on function public.usage_all_facts() from public, anon, authenticated;
revoke all on function public.usage_summary_json(public.usage_fact[]) from public, anon, authenticated;
revoke all on function public.usage_funnel_json(public.usage_fact[], integer) from public, anon, authenticated;
revoke all on function public.usage_daily_json(public.usage_fact[], public.usage_event[], integer) from public, anon, authenticated;
revoke all on function public.usage_users_json(public.usage_fact[]) from public, anon, authenticated;
grant execute on function public.usage_record_subscription(uuid, text, text, text, timestamptz, boolean, text, text, timestamptz, timestamptz, timestamptz) to service_role;

revoke all on function public.owner_usage(integer) from public, anon;
revoke all on function public.owner_usage_summary() from public, anon;
revoke all on function public.owner_usage_funnel(integer) from public, anon;
revoke all on function public.owner_usage_users() from public, anon;
revoke all on function public.owner_usage_daily(integer) from public, anon;
revoke all on function public.owner_usage_follow_ups() from public, anon;
grant execute on function public.owner_usage(integer) to authenticated;
grant execute on function public.owner_usage_summary() to authenticated;
grant execute on function public.owner_usage_funnel(integer) to authenticated;
grant execute on function public.owner_usage_users() to authenticated;
grant execute on function public.owner_usage_daily(integer) to authenticated;
grant execute on function public.owner_usage_follow_ups() to authenticated;

-- ---- Recommended indexes (not created here; run them if you want them) -------------------------------------------------
-- The page reads every meal once per load. Without these, Postgres reads each meal's analysis_json (the big column) to
-- tell meals from supplements; with them it reads only these small indexes. Both are partial, so they stay small, and
-- CONCURRENTLY builds them without locking the meals table (run each line on its own, not inside a transaction).
--
-- create index concurrently if not exists meals_real_user_ts_idx on public.meals (user_id, ts, created_at)
--   where coalesce(status, 'done') <> 'failed' and coalesce(analysis_json->>'source', '') <> 'supplement';
-- create index concurrently if not exists meals_supplement_user_ts_idx on public.meals (user_id, ts, created_at)
--   where coalesce(status, 'done') <> 'failed' and analysis_json->>'source' = 'supplement';
--
-- The other tables it reads are small or already keyed by user (feel_logs, workouts, weight_logs, step_logs, sleep_logs,
-- push_tokens, profiles). If step_logs grows large, this helps the Health sync lookup:
-- create index concurrently if not exists step_logs_user_synced_idx on public.step_logs (user_id, synced_at);
