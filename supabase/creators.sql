-- Creator program (whatyouate.app/creators).
--
-- Additive only: new tables and functions. Nothing that already exists is altered, so
-- running this cannot change how the app behaves until app code starts calling it.
--
-- Rules come from the program terms (whatyouate.app/creators/terms):
--   * a follower enters a code as they sign up; that links them to the creator. The free month
--     itself is Apple's: the app then offers the "Monthly (Creator)" plan, whose introductory
--     offer is 1 month free. Nothing here unlocks anything in the app.
--   * creators earn 30% of what Apple pays us (after Apple's fee, before income tax)
--     for 12 months after the subscriber's first payment; refunds reverse it
--   * $1 per qualifying signup during the creator's first 30 days, capped at $100;
--     a signup qualifies by logging meals on 3 separate days in its first 7 days
--   * a month's earnings are paid on the 1st of the month after next; under $10 rolls
--     over, except after the creator has left
--   * Canadians earn CAD, everyone else USD
--   * creators get free Pro through Apple one-time offer codes (set not to auto-renew): 3 months
--     once their first signup qualifies, and a year once 3 people they referred have each paid for at
--     least 2 months, or bought a yearly plan (refunds don't count)
--
-- Writes only happen through the security definer functions below. Tables have RLS on
-- with read-own policies where the app or the creator site needs a direct read.

-- Stop if a table with one of these names already exists but isn't ours.
do $$
declare pair text[];
begin
  foreach pair slice 1 in array array[
    ['creators', 'payout_method'], ['creator_codes', 'creator_id'], ['referrals', 'account_created_at'],
    ['creator_earnings', 'source_id'], ['creator_payouts', 'covers_before'], ['creator_pro_codes', 'kind']]
  loop
    if to_regclass('public.' || pair[1]) is not null and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = pair[1] and column_name = pair[2]
    ) then
      raise exception 'public.% already exists and is not a creator program table; nothing was changed', pair[1];
    end if;
  end loop;
end $$;

-- ---- Tables --------------------------------------------------------------------------

create table if not exists public.creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null,
  name text not null check (length(name) between 1 and 80),
  instagram text not null default '' check (length(instagram) <= 40),
  tiktok text not null default '' check (length(tiktok) <= 40),
  country text not null check (country in ('CA', 'US', 'OTHER')),
  currency text generated always as (case when country = 'CA' then 'CAD' else 'USD' end) stored,
  payout_method text not null check (payout_method in ('etransfer', 'paypal', 'wise')),
  payout_email text not null check (length(payout_email) between 3 and 200),
  code text not null,
  status text not null default 'active' check (status in ('active', 'left', 'removed')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Interac for Canadians, PayPal or bank deposit (Wise) for everyone else.
  constraint creators_payout_matches_country check ((country = 'CA') = (payout_method = 'etransfer'))
);

-- Every code ever issued, so old codes keep working and can never be reissued.
create table if not exists public.creator_codes (
  code text primary key check (code ~ '^[A-Z0-9]{3,15}$'),
  creator_id uuid not null references public.creators(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- One row per referred account. user_id is cleared if the account is deleted, so
-- the creator's counts survive without keeping anything that identifies the person.
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  creator_id uuid not null references public.creators(id),
  code text not null,
  account_created_at timestamptz not null,
  redeemed_at timestamptz not null default now(),
  qualified_at timestamptz,
  first_paid_at timestamptz,
  trial_ends_at timestamptz,      -- set when they start the Monthly (Creator) free month
  trial_cancelled_at timestamptz  -- set if they turn off renewal during it
);
create index if not exists referrals_creator_idx on public.referrals (creator_id, redeemed_at);

-- Ledger of everything a creator earns, in the creator's currency.
create table if not exists public.creator_earnings (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id),
  referral_id uuid references public.referrals(id),
  kind text not null check (kind in ('commission', 'refund', 'bonus', 'adjustment')),
  source_id text not null unique, -- RevenueCat event id, or bonus:<referral id>
  occurred_at timestamptz not null,
  amount numeric(12, 4) not null,
  currency text not null check (currency in ('CAD', 'USD')),
  product_id text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists creator_earnings_creator_idx on public.creator_earnings (creator_id, occurred_at);

create table if not exists public.creator_payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id),
  due_on date not null,
  covers_before date not null, -- pays earnings dated before this day (Toronto time)
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency in ('CAD', 'USD')),
  status text not null default 'due' check (status in ('due', 'paid', 'withheld')),
  paid_on date,
  reference text,
  created_at timestamptz not null default now(),
  unique (creator_id, due_on)
);

-- Apple one-time offer codes for creators' own free Pro, loaded in batches from App Store Connect.
create table if not exists public.creator_pro_codes (
  code text primary key,
  kind text not null check (kind in ('3_months', '1_year')),
  creator_id uuid references public.creators(id),
  assigned_at timestamptz,
  reminded_at timestamptz, -- unused: the codes don't auto-renew, so there is nothing to remind about
  expires_on date, -- Apple one-time codes expire at most 6 months after they're generated
  added_at timestamptz not null default now(),
  unique (creator_id, kind)
);

-- Emails sent to creators (lib/server/creatorEmails.ts). A row is claimed before sending, so each
-- email goes out at most once. ref is the creator id (welcome), the Pro code, or the payout id.
create table if not exists public.creator_emails (
  kind text not null check (kind in ('welcome', 'pro_3_months', 'pro_1_year', 'payout')),
  ref text not null,
  creator_id uuid not null references public.creators(id) on delete cascade,
  to_email text not null,
  sent_at timestamptz not null default now(),
  primary key (kind, ref)
);

-- Added after the first release of this file.
alter table public.creator_pro_codes add column if not exists expires_on date;
alter table public.referrals add column if not exists trial_ends_at timestamptz;
alter table public.referrals add column if not exists trial_cancelled_at timestamptz;

alter table public.creators enable row level security;
alter table public.creator_pro_codes enable row level security;
alter table public.creator_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.creator_earnings enable row level security;
alter table public.creator_payouts enable row level security;
alter table public.creator_emails enable row level security;

drop policy if exists "Creators can read own row" on public.creators;
create policy "Creators can read own row" on public.creators
  for select using (auth.uid() = user_id);

drop policy if exists "Users can read own referral" on public.referrals;
create policy "Users can read own referral" on public.referrals
  for select using (auth.uid() = user_id);

-- No other policies: codes, earnings, payouts and the email log are only reached through functions
-- or the service role.

-- ---- Codes ---------------------------------------------------------------------------

create or replace function public.creator_normalize_code(p_code text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Why a code can't be used, or null when it can. p_creator lets a creator pick one of
-- their own earlier codes again.
create or replace function public.creator_code_problem(p_code text, p_creator uuid default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  c text := public.creator_normalize_code(p_code);
  owner uuid;
begin
  if length(c) < 3 then return 'short'; end if;
  if length(c) > 15 then return 'long'; end if;
  if c = any (array['WHATYOUATE', 'WYA', 'ADMIN', 'SUPPORT', 'HELP', 'FREE', 'TEST', 'APPLE',
                    'APPSTORE', 'PROMO', 'CODE', 'CREATOR', 'CREATORS', 'OFFICIAL', 'STAFF', 'TEAM',
                    'INTEGRITYSTACK', 'YOURCODE', 'YOURNAME', 'EXAMPLE', 'SAMPLE']) then
    return 'reserved';
  end if;
  if c ~ '(FUCK|SHIT|BITCH|CUNT|DICK|NAZI|PORN|SEX|WHORE|SLUT|FAG|NIGG|RAPE|KILL|HITLER)' then
    return 'blocked';
  end if;
  select creator_id into owner from creator_codes where code = c;
  if owner is not null and owner is distinct from p_creator then return 'taken'; end if;
  return null;
end $$;

-- Public check for the join form.
create or replace function public.creator_check_code(p_code text)
returns text language plpgsql stable security definer set search_path = public as $$
declare me uuid;
begin
  select id into me from creators where user_id = auth.uid();
  return public.creator_code_problem(p_code, me);
end $$;

-- First name for the share page ("Sarah Sent You"). Only for codes that still work.
create or replace function public.creator_public_name(p_code text)
returns text language sql stable security definer set search_path = public as $$
  select split_part(cr.name, ' ', 1)
  from creator_codes cc join creators cr on cr.id = cc.creator_id
  where cc.code = public.creator_normalize_code(p_code) and cr.status = 'active'
$$;

-- ---- Creator account -----------------------------------------------------------------

-- Hands the creator an unused Apple code of this kind, once. Returns null when the pool
-- is empty (the daily report flags that).
create or replace function public.creator_assign_pro_code(p_creator uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare picked text;
begin
  select code into picked from creator_pro_codes where creator_id = p_creator and kind = p_kind;
  if picked is not null then return picked; end if;
  -- Soonest-expiring first, skipping codes with under two weeks left to redeem.
  update creator_pro_codes set creator_id = p_creator, assigned_at = now()
  where code = (select code from creator_pro_codes
                where creator_id is null and kind = p_kind
                  and (expires_on is null or expires_on > current_date + 14)
                order by expires_on nulls last, added_at, code limit 1 for update skip locked)
  returning code into picked;
  return picked;
end $$;

-- How many of a creator's referrals count toward the free year: each has paid for at least
-- 2 months, or for a yearly plan, after refunds.
create or replace function public.creator_year_progress(p_creator uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from (
    select referral_id from creator_earnings
    where creator_id = p_creator and kind in ('commission', 'refund')
    group by referral_id
    having sum(case when kind = 'commission' then 1 else -1 end
               * case when product_id ilike '%year%' then 12 else 1 end) >= 2
  ) x
$$;

-- The free year: once 3 referrals count (see creator_year_progress).
create or replace function public.creator_check_year_code(p_creator uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if (select status from creators where id = p_creator) <> 'active' then return null; end if;
  if public.creator_year_progress(p_creator) < 3 then return null; end if;
  return public.creator_assign_pro_code(p_creator, '1_year');
end $$;

-- Gives a 3-month code to any active creator who has unlocked one (a qualified signup) but didn't get
-- it because the pool was empty at the time.
create or replace function public.creator_backfill_pro_codes()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    select id from creators cr where status = 'active'
      and exists (select 1 from referrals rf where rf.creator_id = cr.id and rf.qualified_at is not null)
      and not exists (select 1 from creator_pro_codes p where p.creator_id = cr.id and p.kind = '3_months')
    order by joined_at
  loop
    if public.creator_assign_pro_code(r.id, '3_months') is null then exit; end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Adds a batch of codes downloaded from App Store Connect, with the batch's expiry date.
-- Already-known codes are skipped.
drop function if exists public.creator_add_pro_codes(text, text[]);
create or replace function public.creator_add_pro_codes(p_kind text, p_codes text[], p_expires date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare added integer;
begin
  insert into creator_pro_codes (code, kind, expires_on)
  select distinct trim(c), p_kind, p_expires from unnest(p_codes) c where trim(c) <> ''
  on conflict (code) do nothing;
  get diagnostics added = row_count;
  return added;
end $$;

create or replace function public.creator_join(
  p_name text, p_instagram text, p_tiktok text, p_code text,
  p_country text, p_payout_method text, p_payout_email text
) returns public.creators language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c text := public.creator_normalize_code(p_code);
  problem text;
  me creators;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from creators where user_id = uid) then raise exception 'already_joined'; end if;
  problem := public.creator_code_problem(c, null);
  if problem is not null then raise exception 'code_%', problem; end if;

  insert into creators (user_id, email, name, instagram, tiktok, country, payout_method, payout_email, code)
  values (uid, (select lower(email) from auth.users where id = uid), trim(p_name),
          coalesce(trim(p_instagram), ''), coalesce(trim(p_tiktok), ''),
          p_country, p_payout_method, trim(p_payout_email), c)
  returning * into me;
  insert into creator_codes (code, creator_id) values (c, me.id);
  return me;
end $$;

create or replace function public.creator_update_profile(
  p_name text, p_instagram text, p_tiktok text,
  p_country text, p_payout_method text, p_payout_email text
) returns public.creators language plpgsql security definer set search_path = public as $$
declare me creators;
begin
  select * into me from creators where user_id = auth.uid() and status = 'active';
  if me.id is null then raise exception 'not_a_creator'; end if;
  -- Earnings are recorded in the creator's currency, so the country is fixed once
  -- anything has been earned.
  if p_country <> me.country and exists (select 1 from creator_earnings where creator_id = me.id) then
    raise exception 'country_locked';
  end if;
  update creators set
    name = trim(p_name), instagram = coalesce(trim(p_instagram), ''), tiktok = coalesce(trim(p_tiktok), ''),
    country = p_country, payout_method = p_payout_method, payout_email = trim(p_payout_email),
    updated_at = now()
  where id = me.id
  returning * into me;
  return me;
end $$;

-- Old codes stay linked, so anything already posted keeps working.
create or replace function public.creator_change_code(p_code text)
returns public.creators language plpgsql security definer set search_path = public as $$
declare
  c text := public.creator_normalize_code(p_code);
  me creators;
  problem text;
begin
  select * into me from creators where user_id = auth.uid() and status = 'active';
  if me.id is null then raise exception 'not_a_creator'; end if;
  problem := public.creator_code_problem(c, me.id);
  if problem is not null then raise exception 'code_%', problem; end if;
  insert into creator_codes (code, creator_id) values (c, me.id) on conflict (code) do nothing;
  update creators set code = c, updated_at = now() where id = me.id returning * into me;
  return me;
end $$;

create or replace function public.creator_leave()
returns void language plpgsql security definer set search_path = public as $$
begin
  update creators set status = 'left', left_at = now(), updated_at = now()
  where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not_a_creator'; end if;
end $$;

-- ---- Redeeming a code in the app -----------------------------------------------------

-- Called by the app for the signed-in user: links them to the creator. Only new accounts
-- count, only once, and the first code used wins. It unlocks nothing; the app uses the
-- answer to decide whether to show the Monthly (Creator) plan.
create or replace function public.redeem_creator_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c text := public.creator_normalize_code(p_code);
  created timestamptz;
  owner creators;
  existing referrals;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;

  select * into existing from referrals where user_id = uid;
  if existing.id is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed', 'code', existing.code);
  end if;

  select cr.* into owner from creator_codes cc join creators cr on cr.id = cc.creator_id where cc.code = c;
  if owner.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown_code'); end if;
  if owner.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'inactive_code'); end if;
  if owner.user_id = uid then return jsonb_build_object('ok', false, 'reason', 'own_code'); end if;

  select u.created_at into created from auth.users u where u.id = uid;
  if created < now() - interval '7 days' then
    return jsonb_build_object('ok', false, 'reason', 'existing_account');
  end if;

  insert into referrals (user_id, creator_id, code, account_created_at)
  values (uid, owner.id, c, created)
  on conflict (user_id) do nothing;
  if not found then
    select * into existing from referrals where user_id = uid;
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed', 'code', existing.code);
  end if;
  return jsonb_build_object('ok', true, 'code', c);
end $$;

-- ---- Server jobs (service role only) -------------------------------------------------

-- Marks signups that logged real meals on 3 separate local days within 7 days of the
-- account being created, and pays the $1 bonus where the terms allow. Safe to rerun.
create or replace function public.creator_mark_qualified()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  third_day timestamptz;
  bonus_so_far numeric;
  marked integer := 0;
begin
  for r in
    select rf.*, cr.joined_at, cr.currency, cr.status as creator_status,
           coalesce(p.timezone_offset_minutes, 300) as tz
    from referrals rf
    join creators cr on cr.id = rf.creator_id
    left join profiles p on p.user_id = rf.user_id
    where rf.qualified_at is null
      and rf.user_id is not null
      and rf.account_created_at > now() - interval '9 days'
  loop
    -- First meal of the third distinct local day inside the 7-day window.
    select min(t) into third_day from (
      select d, min(t) as t, dense_rank() over (order by d) as n
      from (
        -- The meal's moment, matching lib/supabaseDb.ts: the explicit ts (ms) wins over created_at.
        select mt.t, ((mt.t at time zone 'UTC') - make_interval(mins => r.tz))::date as d
        from meals m
        cross join lateral (
          select case when coalesce(nullif(m.ts::text, '')::numeric, 0) > 0
                      then to_timestamp(nullif(m.ts::text, '')::numeric / 1000.0) else m.created_at end as t
        ) mt
        where m.user_id = r.user_id
          and coalesce(m.status, 'done') <> 'failed'
          and m.analysis_json ? 'estimated_ranges'
          and coalesce(m.analysis_json->>'source', '') <> 'supplement'
      ) x
      where t >= r.account_created_at and t < r.account_created_at + interval '7 days'
      group by d
    ) days
    where n = 3;

    continue when third_day is null;

    update referrals set qualified_at = third_day where id = r.id;
    marked := marked + 1;

    -- A creator's first qualified signup unlocks their 3 months of free Pro.
    if r.creator_status = 'active' then
      perform public.creator_assign_pro_code(r.creator_id, '3_months');
    end if;

    if r.creator_status <> 'removed' and r.redeemed_at < r.joined_at + interval '30 days' then
      select coalesce(sum(amount), 0) into bonus_so_far
      from creator_earnings where creator_id = r.creator_id and kind = 'bonus';
      if bonus_so_far < 100 then
        insert into creator_earnings (creator_id, referral_id, kind, source_id, occurred_at, amount, currency)
        values (r.creator_id, r.id, 'bonus', 'bonus:' || r.id, third_day, least(1, 100 - bonus_so_far), r.currency)
        on conflict (source_id) do nothing;
      end if;
    end if;
  end loop;
  return marked;
end $$;

-- Free month tracking for the dashboard's "In Their Free Month" count. Called by the webhook route:
-- 'start' when a referred user starts a free trial, 'cancel' when they turn off renewal during it,
-- 'uncancel' when they turn it back on. Returns what happened, for logging.
create or replace function public.creator_record_trial(p_app_user_ids text[], p_action text, p_trial_ends_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare rf referrals;
begin
  select * into rf from referrals where user_id::text = any (p_app_user_ids) limit 1;
  if rf.id is null then return 'not_referred'; end if;
  if p_action = 'start' then
    update referrals set trial_ends_at = p_trial_ends_at, trial_cancelled_at = null where id = rf.id;
  elsif p_action = 'cancel' then
    if rf.first_paid_at is not null or rf.trial_ends_at is null then return 'not_in_trial'; end if;
    update referrals set trial_cancelled_at = now() where id = rf.id;
  elsif p_action = 'uncancel' then
    update referrals set trial_cancelled_at = null where id = rf.id;
  else
    return 'unknown_action';
  end if;
  return 'trial_' || p_action;
end $$;

-- Records one RevenueCat transaction for a referred user. Called by the webhook route,
-- which passes the event fields plus the USD to CAD rate for the purchase day.
-- Returns what happened, for logging.
create or replace function public.creator_record_transaction(
  p_event_id text,
  p_app_user_ids text[],      -- app_user_id, original_app_user_id and aliases
  p_purchased_at timestamptz,
  p_product_id text,
  p_price_usd numeric,        -- negative for refunds
  p_price_local numeric,      -- in p_currency, negative for refunds
  p_currency text,
  p_tax_pct numeric,
  p_store_pct numeric,
  p_usd_cad numeric           -- CAD per USD on the purchase day
) returns text language plpgsql security definer set search_path = public as $$
declare
  rf referrals;
  cr creators;
  base numeric;
  amount numeric;
begin
  select * into rf from referrals
  where user_id::text = any (p_app_user_ids)
  limit 1;
  if rf.id is null then return 'not_referred'; end if;
  if coalesce(p_price_usd, 0) = 0 then return 'zero_price'; end if;
  select * into cr from creators where id = rf.creator_id;

  if p_price_usd > 0 then
    if rf.first_paid_at is null then
      update referrals set first_paid_at = p_purchased_at where id = rf.id returning * into rf;
    end if;
    if p_purchased_at >= rf.first_paid_at + interval '12 months' then return 'past_12_months'; end if;
  else
    -- A refund only reverses something we paid commission on.
    if not exists (select 1 from creator_earnings where referral_id = rf.id and kind = 'commission') then
      return 'refund_without_commission';
    end if;
  end if;

  -- Their payment in the creator's currency, converted on the day they paid.
  if upper(coalesce(p_currency, '')) = cr.currency and p_price_local is not null then
    base := p_price_local;
  elsif cr.currency = 'USD' then
    base := p_price_usd;
  elsif p_usd_cad is not null then
    base := p_price_usd * p_usd_cad;
  else
    raise exception 'missing_fx_rate';
  end if;

  -- What Apple pays us: price less sales tax, less Apple's fee.
  amount := base * (1 - coalesce(p_tax_pct, 0)) * (1 - coalesce(p_store_pct, 0.15)) * 0.30;

  insert into creator_earnings (creator_id, referral_id, kind, source_id, occurred_at, amount, currency, product_id, detail)
  values (cr.id, rf.id, case when p_price_usd > 0 then 'commission' else 'refund' end, p_event_id,
          p_purchased_at, amount, cr.currency, p_product_id,
          jsonb_build_object('price_usd', p_price_usd, 'price_local', p_price_local, 'currency', p_currency,
                             'tax_pct', p_tax_pct, 'store_pct', p_store_pct, 'usd_cad', p_usd_cad))
  on conflict (source_id) do nothing;
  if not found then return 'duplicate'; end if;
  if p_price_usd > 0 then perform public.creator_check_year_code(cr.id); end if;
  return case when p_price_usd > 0 then 'commission' else 'refund' end;
end $$;

-- Creates the payouts due on p_today (the 1st of a month): everything earned before the
-- start of last month, less what has already been paid out. Safe to rerun.
create or replace function public.creator_create_payouts(p_today date)
returns setof public.creator_payouts language plpgsql security definer set search_path = public as $$
declare
  cutoff date := (date_trunc('month', p_today) - interval '1 month')::date;
  cutoff_ts timestamptz := cutoff::timestamp at time zone 'America/Toronto';
  r record;
  made creator_payouts;
begin
  for r in
    select cr.id, cr.currency, cr.status,
      (select coalesce(sum(amount), 0) from creator_earnings e where e.creator_id = cr.id and e.occurred_at < cutoff_ts)
      - (select coalesce(sum(amount), 0) from creator_payouts p where p.creator_id = cr.id) as balance
    from creators cr
    where cr.status <> 'removed'
  loop
    made := null;
    if round(r.balance, 2) >= 10 or (r.status = 'left' and round(r.balance, 2) > 0) then
      insert into creator_payouts (creator_id, due_on, covers_before, amount, currency)
      values (r.id, p_today, cutoff, round(r.balance, 2), r.currency)
      on conflict (creator_id, due_on) do nothing
      returning * into made;
      if made.id is not null then return next made; end if;
    end if;
  end loop;
end $$;

-- ---- Creator dashboard ---------------------------------------------------------------

-- Everything the dashboard shows, for the signed-in creator. Totals only: nothing here
-- identifies anyone who used the code. Months and weeks are in Toronto time.
create or replace function public.creator_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cr creators;
  tz constant text := 'America/Toronto';
  now_local timestamp := now() at time zone tz;
  month_start timestamptz := date_trunc('month', now_local) at time zone tz;
  next_first date := (date_trunc('month', now_local) + interval '1 month')::date;
  pay_date date;
  pay_estimate numeric;
  owed_before numeric;
  paid_total numeric;
  result jsonb;
begin
  select * into cr from creators where user_id = auth.uid();
  if cr.id is null then return null; end if;

  select coalesce(sum(amount), 0) into paid_total from creator_payouts where creator_id = cr.id;

  -- Next payout: a payout already created and not yet sent, otherwise the next 1st that
  -- would pay something, otherwise the 1st after that with what's been earned so far.
  select due_on, amount into pay_date, pay_estimate
  from creator_payouts where creator_id = cr.id and status = 'due' order by due_on limit 1;
  if pay_date is null then
    select coalesce(sum(amount), 0) - paid_total into owed_before from creator_earnings
    where creator_id = cr.id
      and occurred_at < ((next_first - interval '1 month')::timestamp at time zone tz);
    if round(owed_before, 2) >= 10 or (cr.status = 'left' and round(owed_before, 2) > 0) then
      pay_date := next_first;
      pay_estimate := owed_before;
    else
      pay_date := (next_first + interval '1 month')::date;
      select coalesce(sum(amount), 0) - paid_total into pay_estimate from creator_earnings
      where creator_id = cr.id and occurred_at < month_start + interval '1 month';
    end if;
  end if;

  select jsonb_build_object(
    'creator', jsonb_build_object(
      'name', cr.name, 'email', cr.email, 'instagram', cr.instagram, 'tiktok', cr.tiktok,
      'country', cr.country, 'currency', cr.currency, 'payoutMethod', cr.payout_method,
      'payoutEmail', cr.payout_email, 'code', cr.code, 'status', cr.status,
      'joined', (cr.joined_at at time zone tz)::date,
      'bonusEnds', ((cr.joined_at + interval '30 days') at time zone tz)::date,
      'oldCodes', (select coalesce(jsonb_agg(code order by created_at), '[]'::jsonb)
                   from creator_codes where creator_id = cr.id and code <> cr.code)
    ),
    -- Followers trying Pro right now: started the free month, haven't paid yet, still renewing.
    'freeMonth', (select count(*) from referrals where creator_id = cr.id and first_paid_at is null
                    and trial_ends_at > now() and trial_cancelled_at is null),
    'pro', jsonb_build_object(
      'threeMonths', (select code from creator_pro_codes where creator_id = cr.id and kind = '3_months'),
      'year', (select code from creator_pro_codes where creator_id = cr.id and kind = '1_year'),
      'unlocked', exists (select 1 from referrals where creator_id = cr.id and qualified_at is not null),
      'paying', public.creator_year_progress(cr.id)
    ),
    'month', jsonb_build_object(
      'label', trim(to_char(now_local, 'FMMonth')),
      'codeUses', (select count(*) from referrals where creator_id = cr.id and redeemed_at >= month_start),
      'qualified', (select count(*) from referrals where creator_id = cr.id and qualified_at >= month_start),
      'newPaid', (select count(*) from referrals where creator_id = cr.id and first_paid_at >= month_start),
      'bonus', (select coalesce(round(sum(amount), 2), 0) from creator_earnings
                where creator_id = cr.id and kind = 'bonus' and occurred_at >= month_start),
      'commission', (select coalesce(round(sum(amount), 2), 0) from creator_earnings
                     where creator_id = cr.id and kind in ('commission', 'refund') and occurred_at >= month_start)
    ),
    'allTime', jsonb_build_object(
      'paidSubs', (select count(*) from referrals where creator_id = cr.id and first_paid_at is not null),
      'earned', (select coalesce(round(sum(amount), 2), 0) from creator_earnings where creator_id = cr.id),
      'paidOut', (select coalesce(sum(amount), 0) from creator_payouts where creator_id = cr.id and status = 'paid')
    ),
    'nextPayout', jsonb_build_object(
      'date', trim(to_char(pay_date, 'FMMonth FMDD')),
      'covers', trim(to_char(pay_date - interval '2 months', 'FMMonth')),
      'estimate', greatest(round(pay_estimate, 2), 0)
    ),
    -- What current subscribers are on track to earn each month: each one's latest
    -- payment while it's still running, with yearly plans spread over 12 months.
    'recurring', (
      select jsonb_build_object('monthly', coalesce(round(sum(monthly), 2), 0), 'active', count(*))
      from (
        select distinct on (e.referral_id)
          case when e.product_id ilike '%year%' then e.amount / 12 else e.amount end as monthly,
          e.kind, e.product_id, e.occurred_at, rf.first_paid_at
        from creator_earnings e join referrals rf on rf.id = e.referral_id
        where e.creator_id = cr.id and e.kind in ('commission', 'refund')
        order by e.referral_id, e.occurred_at desc, e.kind = 'refund' desc
      ) latest
      where kind = 'commission'
        and occurred_at > now() - case when product_id ilike '%year%' then interval '366 days' else interval '35 days' end
        and now() < first_paid_at + interval '12 months'
    ),
    'statement', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(m, 'YYYY-MM'),
        'codeUses', (select count(*) from referrals where creator_id = cr.id
                     and (redeemed_at at time zone tz) >= m and (redeemed_at at time zone tz) < m + interval '1 month'),
        'signups', (select count(*) from referrals where creator_id = cr.id
                    and (qualified_at at time zone tz) >= m and (qualified_at at time zone tz) < m + interval '1 month'),
        'newPaid', (select count(*) from referrals where creator_id = cr.id
                    and (first_paid_at at time zone tz) >= m and (first_paid_at at time zone tz) < m + interval '1 month'),
        'bonus', (select coalesce(round(sum(amount), 2), 0) from creator_earnings where creator_id = cr.id and kind = 'bonus'
                  and (occurred_at at time zone tz) >= m and (occurred_at at time zone tz) < m + interval '1 month'),
        'commission', (select coalesce(round(sum(amount), 2), 0) from creator_earnings where creator_id = cr.id
                       and kind in ('commission', 'refund')
                       and (occurred_at at time zone tz) >= m and (occurred_at at time zone tz) < m + interval '1 month'),
        'paid', (select coalesce(sum(amount), 0) from creator_payouts where creator_id = cr.id and status = 'paid'
                 and paid_on >= m::date and paid_on < (m + interval '1 month')::date),
        'paidOn', (select coalesce(to_char(max(paid_on), 'YYYY-MM-DD'), '') from creator_payouts where creator_id = cr.id
                   and status = 'paid' and paid_on >= m::date and paid_on < (m + interval '1 month')::date)
      ) order by m), '[]'::jsonb)
      from generate_series(date_trunc('month', cr.joined_at at time zone tz), date_trunc('month', now_local), interval '1 month') m
    ),
    'weekly', (
      select jsonb_agg(jsonb_build_object(
        'week', trim(to_char(w, 'Mon FMDD')),
        'uses', (select count(*) from referrals where creator_id = cr.id
                 and (redeemed_at at time zone tz) >= w and (redeemed_at at time zone tz) < w + interval '7 days')
      ) order by w)
      from generate_series(date_trunc('week', now_local) - interval '4 weeks', date_trunc('week', now_local), interval '1 week') w
    )
  ) into result;
  return result;
end $$;

-- ---- Owner page and issued statements (whatyouate.app/creators/owner) -----------------------
-- Owners are listed by login email. The page's data only comes out of these functions, and each
-- one checks the caller is an owner, so finding the page's address shows nothing.
create table if not exists public.creator_owners (
  email text primary key check (email = lower(email))
);
alter table public.creator_owners enable row level security;

-- A statement is frozen when its payout is marked paid, so later refunds land on the next one.
alter table public.creator_payouts add column if not exists paid_at timestamptz;
alter table public.creator_payouts add column if not exists statement jsonb;
-- Set when a paid payout comes back (an e-Transfer expires, a bank deposit fails) and is reopened.
alter table public.creator_payouts add column if not exists returned_at timestamptz;

-- The owner's private notes on each creator. Kept apart from creators, which creators can read.
create table if not exists public.creator_owner_notes (
  creator_id uuid primary key references public.creators(id) on delete cascade,
  notes text not null default '' check (length(notes) <= 4000),
  posted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.creator_owner_notes enable row level security;

create or replace function public.creator_is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from creator_owners o join auth.users u on lower(u.email) = o.email
    where u.id = auth.uid()
  );
$$;

-- What a payout covers: every month since the previous paid payout (or since joining), up to the
-- payout's cutoff, plus the creator's details as they were when it was paid.
create or replace function public.creator_statement_snapshot(p_payout uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tz constant text := 'America/Toronto';
  p creator_payouts;
  cr creators;
  prev date;
  first_month date;
  from_ts timestamptz;
  to_ts timestamptz;
begin
  select * into p from creator_payouts where id = p_payout;
  if p.id is null then return null; end if;
  select * into cr from creators where id = p.creator_id;
  select max(covers_before) into prev from creator_payouts
  where creator_id = cr.id and status = 'paid' and id <> p.id and covers_before < p.covers_before;
  first_month := coalesce(prev, date_trunc('month', cr.joined_at at time zone tz)::date);
  from_ts := case when prev is null then '-infinity'::timestamptz else prev::timestamp at time zone tz end;
  to_ts := p.covers_before::timestamp at time zone tz;

  return jsonb_build_object(
    'payout', jsonb_build_object(
      'id', p.id, 'amount', p.amount, 'currency', p.currency, 'paidOn', p.paid_on, 'reference', coalesce(p.reference, ''),
      'method', cr.payout_method, 'payoutEmail', cr.payout_email
    ),
    'period', jsonb_build_object('from', first_month, 'to', p.covers_before - 1),
    'creator', jsonb_build_object(
      'name', cr.name, 'email', cr.email, 'instagram', cr.instagram, 'tiktok', cr.tiktok, 'country', cr.country,
      'currency', cr.currency, 'payoutMethod', cr.payout_method, 'payoutEmail', cr.payout_email, 'code', cr.code,
      'joined', (cr.joined_at at time zone tz)::date
    ),
    'months', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'month', to_char(m, 'YYYY-MM'),
        'codeUses', (select count(*) from referrals where creator_id = cr.id
                     and (redeemed_at at time zone tz) >= m and (redeemed_at at time zone tz) < m + interval '1 month'),
        'signups', (select count(*) from referrals where creator_id = cr.id
                    and (qualified_at at time zone tz) >= m and (qualified_at at time zone tz) < m + interval '1 month'),
        'newPaid', (select count(*) from referrals where creator_id = cr.id
                    and (first_paid_at at time zone tz) >= m and (first_paid_at at time zone tz) < m + interval '1 month'),
        'bonus', (select coalesce(round(sum(amount), 2), 0) from creator_earnings where creator_id = cr.id and kind = 'bonus'
                  and occurred_at >= from_ts and occurred_at < to_ts
                  and (occurred_at at time zone tz) >= m and (occurred_at at time zone tz) < m + interval '1 month'),
        'commission', (select coalesce(round(sum(amount), 2), 0) from creator_earnings where creator_id = cr.id
                       and kind in ('commission', 'refund', 'adjustment')
                       and occurred_at >= from_ts and occurred_at < to_ts
                       and (occurred_at at time zone tz) >= m and (occurred_at at time zone tz) < m + interval '1 month')
      ) order by m), '[]'::jsonb)
      from generate_series(first_month::timestamp, (p.covers_before - interval '1 month')::timestamp, interval '1 month') m
    ),
    'allTime', jsonb_build_object(
      'earned', (select coalesce(round(sum(amount), 2), 0) from creator_earnings where creator_id = cr.id and occurred_at < to_ts),
      'paidOut', (select coalesce(sum(amount), 0) from creator_payouts where creator_id = cr.id and status = 'paid'
                  and covers_before <= p.covers_before)
    )
  );
end $$;

-- Everything on the owner page: one entry per creator. With no month, all-time numbers and each
-- creator's latest payout; with a month, that month's activity and the payout worked out that month.
-- Paid out and owed overall are always all time.
drop function if exists public.owner_overview();
create or replace function public.owner_overview(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tz constant text := 'America/Toronto';
  m_first date := date_trunc('month', p_month)::date;
  m_start timestamptz := case when p_month is null then '-infinity'::timestamptz else m_first::timestamp at time zone tz end;
  m_end timestamptz := case when p_month is null then 'infinity'::timestamptz else (m_first + interval '1 month')::timestamp at time zone tz end;
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  return jsonb_build_object(
    'month', to_char(m_first, 'YYYY-MM'),
    'months', (
      select coalesce(jsonb_agg(to_char(m, 'YYYY-MM') order by m desc), '[]'::jsonb)
      from generate_series(date_trunc('month', coalesce((select min(joined_at) from creators), now()) at time zone tz),
                           date_trunc('month', now() at time zone tz), interval '1 month') m
    ),
    'creators', (
      select coalesce(jsonb_agg(x order by x.sort_due desc, x.joined desc), '[]'::jsonb) from (
        select
          cr.id, cr.name, cr.email, cr.code, cr.country, cr.currency, cr.status, cr.instagram, cr.tiktok,
          cr.payout_method as "payoutMethod", cr.payout_email as "payoutEmail",
          (cr.joined_at at time zone tz)::date as joined,
          (select count(*) from referrals where creator_id = cr.id and redeemed_at >= m_start and redeemed_at < m_end) as "codeUses",
          (select count(*) from referrals where creator_id = cr.id and qualified_at >= m_start and qualified_at < m_end) as signups,
          (select count(*) from referrals where creator_id = cr.id and first_paid_at >= m_start and first_paid_at < m_end) as paying,
          (select coalesce(round(sum(amount), 2), 0) from creator_earnings
           where creator_id = cr.id and occurred_at >= m_start and occurred_at < m_end) as earned,
          (select coalesce(sum(amount), 0) from creator_payouts where creator_id = cr.id and status = 'paid'
           and (p_month is null or (paid_on >= m_first and paid_on < m_first + interval '1 month'))) as "paidOut",
          (select coalesce(round(sum(amount), 2), 0) from creator_earnings where creator_id = cr.id)
            - (select coalesce(sum(amount), 0) from creator_payouts where creator_id = cr.id and status = 'paid') as owed,
          (select jsonb_build_object('id', p.id, 'amount', p.amount, 'status', p.status, 'dueOn', p.due_on,
                                     'paidOn', p.paid_on, 'reference', coalesce(p.reference, ''), 'returned', p.returned_at is not null)
           from creator_payouts p where p.creator_id = cr.id
             and (p_month is null or (p.due_on >= m_first and p.due_on < m_first + interval '1 month'))
           order by (p.status <> 'paid') desc, p.due_on desc limit 1) as payout,
          coalesce(n.notes, '') as notes,
          coalesce(n.posted, false) as posted,
          exists (select 1 from creator_payouts p where p.creator_id = cr.id and p.status = 'due') as sort_due
        from creators cr
        left join creator_owner_notes n on n.creator_id = cr.id
      ) x
    ),
    'proCodes', jsonb_build_object(
      'threeMonths', (select count(*) from creator_pro_codes where creator_id is null and kind = '3_months'
                      and (expires_on is null or expires_on > current_date + 14)),
      'year', (select count(*) from creator_pro_codes where creator_id is null and kind = '1_year'
               and (expires_on is null or expires_on > current_date + 14))
    )
  );
end $$;

-- Marks a payout paid (freezing its statement) or withheld, or puts a withheld one back to due.
-- A paid payout can't be changed here: its email and statement have gone out.
create or replace function public.owner_set_payout(p_payout uuid, p_status text, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p creator_payouts;
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  if p_status not in ('paid', 'due', 'withheld') then raise exception 'bad_status'; end if;
  select * into p from creator_payouts where id = p_payout for update;
  if p.id is null then raise exception 'no_payout'; end if;
  if p.status = 'paid' then raise exception 'already_paid'; end if;

  if p_status = 'paid' then
    update creator_payouts
    set status = 'paid', paid_on = (now() at time zone 'America/Toronto')::date, paid_at = now(),
        reference = coalesce(nullif(trim(p_reference), ''), reference)
    where id = p.id;
    update creator_payouts set statement = public.creator_statement_snapshot(p.id) where id = p.id;
  else
    update creator_payouts set status = p_status, reference = coalesce(nullif(trim(p_reference), ''), reference)
    where id = p.id;
  end if;
  return (select jsonb_build_object('id', id, 'status', status, 'paidOn', paid_on) from creator_payouts where id = p.id);
end $$;

-- A paid payout that came back (an e-Transfer expired, a deposit failed): back to due so it can be
-- resent. Its statement is withdrawn and its email can go out again when it's next marked paid.
create or replace function public.owner_reopen_payout(p_payout uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p creator_payouts;
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  select * into p from creator_payouts where id = p_payout for update;
  if p.id is null then raise exception 'no_payout'; end if;
  if p.status <> 'paid' then raise exception 'not_paid'; end if;
  update creator_payouts
  set status = 'due', paid_on = null, paid_at = null, statement = null, returned_at = now(),
      reference = case when coalesce(reference, '') = '' then 'Returned' else 'Returned: ' || reference end
  where id = p.id;
  delete from creator_emails where kind = 'payout' and ref = p.id::text;
  return jsonb_build_object('id', p.id, 'status', 'due');
end $$;

-- The owner's notes on a creator, and whether they've posted yet.
create or replace function public.owner_update_creator(p_creator uuid, p_notes text, p_posted boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  insert into creator_owner_notes (creator_id, notes, posted, updated_at)
  values (p_creator, left(coalesce(p_notes, ''), 4000), coalesce(p_posted, false), now())
  on conflict (creator_id) do update set notes = excluded.notes, posted = excluded.posted, updated_at = now();
end $$;

-- Removes a creator for breaking the terms (their code stops working, nothing new is paid, and any
-- payout waiting to be sent can be withheld), or restores a removed one.
create or replace function public.owner_set_creator_status(p_creator uuid, p_status text, p_withhold boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare
  cr creators;
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  select * into cr from creators where id = p_creator for update;
  if cr.id is null then raise exception 'no_creator'; end if;
  if p_status = 'removed' then
    update creators set status = 'removed', left_at = coalesce(left_at, now()), updated_at = now() where id = cr.id;
    if p_withhold then
      update creator_payouts set status = 'withheld' where creator_id = cr.id and status = 'due';
    end if;
  elsif p_status = 'active' then
    if cr.status <> 'removed' then raise exception 'not_removed'; end if;
    update creators set status = 'active', left_at = null, updated_at = now() where id = cr.id;
  else
    raise exception 'bad_status';
  end if;
  return p_status;
end $$;

-- Every payout, with who it was for, for the owner's spreadsheet.
create or replace function public.owner_export()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', cr.name, 'email', cr.email, 'code', cr.code, 'country', cr.country,
      'payoutMethod', cr.payout_method, 'payoutEmail', cr.payout_email,
      'dueOn', p.due_on, 'coversBefore', p.covers_before, 'amount', p.amount, 'currency', p.currency,
      'status', p.status, 'paidOn', p.paid_on, 'reference', coalesce(p.reference, ''), 'returned', p.returned_at is not null
    ) order by p.due_on desc, cr.name), '[]'::jsonb)
    from creator_payouts p join creators cr on cr.id = p.creator_id
  );
end $$;

-- A creator's issued statements, newest first. Payouts marked paid before statements were frozen
-- are built on the fly.
create or replace function public.creator_statements()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cid uuid;
begin
  select id into cid from creators where user_id = auth.uid();
  if cid is null then return '[]'::jsonb; end if;
  return (
    select coalesce(jsonb_agg(coalesce(statement, public.creator_statement_snapshot(id)) order by paid_on desc, due_on desc), '[]'::jsonb)
    from creator_payouts where creator_id = cid and status = 'paid'
  );
end $$;

-- ---- Permissions ---------------------------------------------------------------------

revoke all on function public.creator_code_problem(text, uuid) from public, anon, authenticated;
revoke all on function public.creator_check_code(text) from public;
revoke all on function public.creator_public_name(text) from public;
revoke all on function public.creator_join(text, text, text, text, text, text, text) from public, anon;
revoke all on function public.creator_update_profile(text, text, text, text, text, text) from public, anon;
revoke all on function public.creator_change_code(text) from public, anon;
revoke all on function public.creator_leave() from public, anon;
revoke all on function public.redeem_creator_code(text) from public, anon;
revoke all on function public.creator_dashboard() from public, anon;
revoke all on function public.creator_mark_qualified() from public, anon, authenticated;
revoke all on function public.creator_record_transaction(text, text[], timestamptz, text, numeric, numeric, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.creator_record_trial(text[], text, timestamptz) from public, anon, authenticated;
revoke all on function public.creator_create_payouts(date) from public, anon, authenticated;
revoke all on function public.creator_assign_pro_code(uuid, text) from public, anon, authenticated;
revoke all on function public.creator_check_year_code(uuid) from public, anon, authenticated;
revoke all on function public.creator_year_progress(uuid) from public, anon, authenticated;
revoke all on function public.creator_add_pro_codes(text, text[], date) from public, anon, authenticated;
revoke all on function public.creator_backfill_pro_codes() from public, anon, authenticated;

grant execute on function public.creator_check_code(text) to anon, authenticated;
grant execute on function public.creator_public_name(text) to anon, authenticated;
grant execute on function public.creator_join(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.creator_update_profile(text, text, text, text, text, text) to authenticated;
grant execute on function public.creator_change_code(text) to authenticated;
grant execute on function public.creator_leave() to authenticated;
grant execute on function public.redeem_creator_code(text) to authenticated;
grant execute on function public.creator_dashboard() to authenticated;
grant execute on function public.creator_mark_qualified() to service_role;
grant execute on function public.creator_record_transaction(text, text[], timestamptz, text, numeric, numeric, text, numeric, numeric, numeric) to service_role;
grant execute on function public.creator_record_trial(text[], text, timestamptz) to service_role;
grant execute on function public.creator_create_payouts(date) to service_role;
grant execute on function public.creator_add_pro_codes(text, text[], date) to service_role;
grant execute on function public.creator_backfill_pro_codes() to service_role;

revoke all on function public.creator_is_owner() from public, anon;
revoke all on function public.creator_statement_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.owner_overview(date) from public, anon;
revoke all on function public.owner_reopen_payout(uuid) from public, anon;
revoke all on function public.owner_update_creator(uuid, text, boolean) from public, anon;
revoke all on function public.owner_set_creator_status(uuid, text, boolean) from public, anon;
revoke all on function public.owner_export() from public, anon;
revoke all on function public.owner_set_payout(uuid, text, text) from public, anon;
revoke all on function public.creator_statements() from public, anon;
grant execute on function public.creator_is_owner() to authenticated;
grant execute on function public.owner_overview(date) to authenticated;
grant execute on function public.owner_reopen_payout(uuid) to authenticated;
grant execute on function public.owner_update_creator(uuid, text, boolean) to authenticated;
grant execute on function public.owner_set_creator_status(uuid, text, boolean) to authenticated;
grant execute on function public.owner_export() to authenticated;
grant execute on function public.owner_set_payout(uuid, text, text) to authenticated;
grant execute on function public.creator_statements() to authenticated;
