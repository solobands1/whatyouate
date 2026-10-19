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
--   * creators get free Pro through Apple offer codes: 3 months when they join, and a year once
--     3 people they referred have paid (refunded payments don't count)
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
  first_paid_at timestamptz
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
  reminded_at timestamptz, -- reminder sent before a 3-month code renews
  added_at timestamptz not null default now(),
  unique (creator_id, kind)
);

alter table public.creators enable row level security;
alter table public.creator_pro_codes enable row level security;
alter table public.creator_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.creator_earnings enable row level security;
alter table public.creator_payouts enable row level security;

drop policy if exists "Creators can read own row" on public.creators;
create policy "Creators can read own row" on public.creators
  for select using (auth.uid() = user_id);

drop policy if exists "Users can read own referral" on public.referrals;
create policy "Users can read own referral" on public.referrals
  for select using (auth.uid() = user_id);

-- No other policies: codes, earnings and payouts are only reached through functions.

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
                    'INTEGRITYSTACK']) then
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
  update creator_pro_codes set creator_id = p_creator, assigned_at = now()
  where code = (select code from creator_pro_codes where creator_id is null and kind = p_kind
                order by added_at, code limit 1 for update skip locked)
  returning code into picked;
  return picked;
end $$;

-- The free year: once 3 people they referred have paid, counting refunds against it.
create or replace function public.creator_check_year_code(p_creator uuid)
returns text language plpgsql security definer set search_path = public as $$
declare paying integer;
begin
  if (select status from creators where id = p_creator) <> 'active' then return null; end if;
  select count(*) into paying from (
    select referral_id from creator_earnings
    where creator_id = p_creator and kind in ('commission', 'refund')
    group by referral_id having sum(amount) > 0
  ) x;
  if paying < 3 then return null; end if;
  return public.creator_assign_pro_code(p_creator, '1_year');
end $$;

-- Gives a 3-month code to any active creator who joined while the pool was empty.
create or replace function public.creator_backfill_pro_codes()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    select id from creators cr where status = 'active'
      and not exists (select 1 from creator_pro_codes p where p.creator_id = cr.id and p.kind = '3_months')
    order by joined_at
  loop
    if public.creator_assign_pro_code(r.id, '3_months') is null then exit; end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Adds a batch of codes downloaded from App Store Connect. Already-known codes are skipped.
create or replace function public.creator_add_pro_codes(p_kind text, p_codes text[])
returns integer language plpgsql security definer set search_path = public as $$
declare added integer;
begin
  insert into creator_pro_codes (code, kind)
  select distinct trim(c), p_kind from unnest(p_codes) c where trim(c) <> ''
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
  perform public.creator_assign_pro_code(me.id, '3_months');
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
    'pro', jsonb_build_object(
      'threeMonths', (select code from creator_pro_codes where creator_id = cr.id and kind = '3_months'),
      'year', (select code from creator_pro_codes where creator_id = cr.id and kind = '1_year'),
      'paying', (select count(*) from (
        select referral_id from creator_earnings
        where creator_id = cr.id and kind in ('commission', 'refund')
        group by referral_id having sum(amount) > 0) x)
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
revoke all on function public.creator_create_payouts(date) from public, anon, authenticated;
revoke all on function public.creator_assign_pro_code(uuid, text) from public, anon, authenticated;
revoke all on function public.creator_check_year_code(uuid) from public, anon, authenticated;
revoke all on function public.creator_add_pro_codes(text, text[]) from public, anon, authenticated;
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
grant execute on function public.creator_create_payouts(date) to service_role;
grant execute on function public.creator_add_pro_codes(text, text[]) to service_role;
grant execute on function public.creator_backfill_pro_codes() to service_role;
