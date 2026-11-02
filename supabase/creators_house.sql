-- House account: WhatYouAte's own creator code (ENERGY) for its socials and in-video games.
--
-- Run once in the Supabase SQL editor, after creators.sql. Safe to rerun.
--   * signups with ENERGY get the same first month free as any creator code (the Monthly (Creator) plan)
--   * the house account's code uses, signups and paying subscribers show on the owner page like a creator's,
--     so you can see what the games bring in
--   * it never earns commission or bonuses, never gets free Pro codes, never appears in payouts, and its
--     welcome and one-week nudge emails are marked as already sent so none go out
-- The same changes are in creators.sql, which stays the full source of truth.

alter table public.creators add column if not exists is_house boolean not null default false;

create or replace function public.creator_backfill_pro_codes()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    select id from creators cr where status = 'active' and not cr.is_house
      and exists (select 1 from referrals rf where rf.creator_id = cr.id and rf.qualified_at is not null)
      and not exists (select 1 from creator_pro_codes p where p.creator_id = cr.id and p.kind = '3_months')
    order by joined_at
  loop
    if public.creator_assign_pro_code(r.id, '3_months') is null then exit; end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.creator_mark_qualified()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  third_day timestamptz;
  bonus_so_far numeric;
  marked integer := 0;
begin
  for r in
    select rf.*, cr.joined_at, cr.currency, cr.status as creator_status, cr.is_house,
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

    -- The house account's signups are counted, but it earns nothing.
    continue when r.is_house;

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
  -- The house account tracks who paid (first_paid_at above) but earns no commission.
  if cr.is_house then return 'house'; end if;

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
    where cr.status <> 'removed' and not cr.is_house
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

create or replace function public.owner_overview(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tz constant text := 'America/Toronto';
  m_first date := date_trunc('month', p_month)::date;
  m_start timestamptz := case when p_month is null then '-infinity'::timestamptz else m_first::timestamp at time zone tz end;
  m_end timestamptz := case when p_month is null then 'infinity'::timestamptz else (m_first + interval '1 month')::timestamp at time zone tz end;
  -- The cutoff the latest payouts were worked out to (the start of last month, Toronto time).
  last_cutoff timestamptz := (date_trunc('month', now() at time zone tz) - interval '1 month')::timestamp at time zone tz;
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
          cr.id, cr.name, cr.email, cr.code, cr.country, cr.currency, cr.status, cr.instagram, cr.tiktok, cr.is_house as house,
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
          -- Earned before the latest cutoff but not in any payout: under $10, so it rolls over.
          greatest(0, round(
            (select coalesce(sum(amount), 0) from creator_earnings where creator_id = cr.id and occurred_at < last_cutoff)
            - (select coalesce(sum(amount), 0) from creator_payouts where creator_id = cr.id), 2)) as "rolledOver",
          (select jsonb_build_object('id', p.id, 'amount', p.amount, 'status', p.status, 'dueOn', p.due_on,
                                     'paidOn', p.paid_on, 'reference', coalesce(p.reference, ''), 'returned', p.returned_at is not null,
                                     'holdReason', coalesce(p.hold_reason, ''))
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

create or replace function public.owner_report(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tz constant text := 'America/Toronto';
  from_ts timestamptz := case when p_from is null then '-infinity'::timestamptz else p_from::timestamp at time zone tz end;
  to_ts timestamptz := case when p_to is null then 'infinity'::timestamptz else p_to::timestamp at time zone tz end;
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'creatorsJoined', (select count(*) from creators where joined_at >= from_ts and joined_at < to_ts and not is_house),
    'creatorsActive', (select count(*) from creators where status = 'active' and not is_house),
    'codeUses', (select count(*) from referrals where redeemed_at >= from_ts and redeemed_at < to_ts),
    'signups', (select count(*) from referrals where qualified_at >= from_ts and qualified_at < to_ts),
    'newPaying', (select count(*) from referrals where first_paid_at >= from_ts and first_paid_at < to_ts),
    'earned', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) order by currency), '[]'::jsonb)
      from (select currency, round(sum(amount), 2) as amount from creator_earnings
            where occurred_at >= from_ts and occurred_at < to_ts group by currency) e
    ),
    'creators', (
      select coalesce(jsonb_agg(x order by x.earned desc, x.name), '[]'::jsonb) from (
        select cr.name, cr.code, cr.currency, cr.country,
          (select count(*) from referrals where creator_id = cr.id and redeemed_at >= from_ts and redeemed_at < to_ts) as "codeUses",
          (select count(*) from referrals where creator_id = cr.id and qualified_at >= from_ts and qualified_at < to_ts) as signups,
          (select count(*) from referrals where creator_id = cr.id and first_paid_at >= from_ts and first_paid_at < to_ts) as "newPaying",
          (select coalesce(round(sum(amount), 2), 0) from creator_earnings where creator_id = cr.id and occurred_at >= from_ts and occurred_at < to_ts) as earned,
          (select coalesce(sum(amount), 0) from creator_payouts where creator_id = cr.id and status = 'paid'
           and (p_from is null or paid_on >= p_from) and (p_to is null or paid_on < p_to)) as paid
        from creators cr
      ) x where x."codeUses" > 0 or x.earned <> 0 or x.paid > 0
    ),
    'payouts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'paidOn', p.paid_on, 'name', cr.name, 'code', cr.code, 'country', cr.country, 'method', cr.payout_method,
        'payoutEmail', cr.payout_email, 'amount', p.amount, 'currency', p.currency, 'reference', coalesce(p.reference, ''),
        'usdCad', p.paid_usd_cad, 'feeCad', p.fee_cad, 'coversBefore', p.covers_before
      ) order by p.paid_on, cr.name), '[]'::jsonb)
      from creator_payouts p join creators cr on cr.id = p.creator_id
      where p.status = 'paid' and (p_from is null or p.paid_on >= p_from) and (p_to is null or p.paid_on < p_to)
    ),
    'withheld', (
      select coalesce(jsonb_agg(jsonb_build_object('name', cr.name, 'amount', p.amount, 'currency', p.currency,
        'dueOn', p.due_on, 'reason', coalesce(p.hold_reason, '')) order by p.due_on), '[]'::jsonb)
      from creator_payouts p join creators cr on cr.id = p.creator_id where p.status = 'withheld'
    ),
    'owedNow', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) order by currency), '[]'::jsonb)
      from (
        select cr.currency,
          round(sum((select coalesce(sum(amount), 0) from creator_earnings where creator_id = cr.id)
                  - (select coalesce(sum(amount), 0) from creator_payouts where creator_id = cr.id and status = 'paid')), 2) as amount
        from creators cr group by cr.currency
      ) o where amount <> 0
    )
  );
end $$;

-- The house account itself.
do $$
declare hid uuid; problem text;
begin
  if exists (select 1 from creators where is_house) then
    raise notice 'The house account already exists; nothing added.';
    return;
  end if;
  problem := public.creator_code_problem('ENERGY', null);
  if problem is not null then raise exception 'ENERGY can''t be used (%); nothing added', problem; end if;
  insert into creators (email, name, country, payout_method, payout_email, code, is_house)
  values ('contact@whatyouate.app', 'WhatYouAte (house code)', 'CA', 'etransfer', 'contact@whatyouate.app', 'ENERGY', true)
  returning id into hid;
  insert into creator_codes (code, creator_id) values ('ENERGY', hid);
  insert into creator_emails (kind, ref, creator_id, to_email) values
    ('welcome', hid::text, hid, 'contact@whatyouate.app'),
    ('nudge', hid::text, hid, 'contact@whatyouate.app')
  on conflict do nothing;
  raise notice 'House account added with code ENERGY.';
end $$;
