-- Comeback ladder (lib/comeback.ts, app/api/cron/reminder): once someone has logged nothing for 3 days, the daily pushes
-- (2pm log reminder, 7pm Nightly Reflection reminder, 9am coach push) stop and three comeback pushes go out at about 6pm
-- their time, on quiet days 3, 7 and 14. Then nothing more until they log again, which resets it.
--
-- This adds one table and one owner read:
--   comeback_pushes         one row per comeback push: who, which step, which quiet stretch, when, whether a device took
--                           it, and when they next logged something if that was within 48 hours. The cron writes the row
--                           BEFORE sending, and a person can only have one row per quiet stretch and step, so a retried or
--                           repeated run can never send the same step twice.
--   owner_comeback_stats()  per step: sent, and back within 48 hours. For the owner Users page on whatyouate.app.
--
-- Additive only: no existing table, column or function changes. Until this is run, the app keeps today's pushes exactly
-- (the crons look for this table at the start of each run and leave the ladder off without it). Safe to re-run.
-- Needs creators.sql (creator_is_owner, creator_owners) and owner_usage.sql (usage_internal_users) first; both are live.

create table if not exists public.comeback_pushes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  stage smallint not null check (stage between 1 and 3),  -- 1 = quiet day 3, 2 = day 7, 3 = day 14
  quiet_since date not null,                               -- their local day the quiet clock counts from: their last
                                                           -- log, or the sign-up day if they never logged anything
  sent_at timestamptz not null default now(),
  delivered boolean not null default false,                -- at least one of their devices accepted the push
  returned_at timestamptz,                                 -- their first log after it, if within 48 hours
  constraint comeback_pushes_once unique (user_id, quiet_since, stage)
);
-- The hourly return check reads delivered pushes still waiting on an answer.
create index if not exists comeback_pushes_waiting_idx on public.comeback_pushes (sent_at) where delivered and returned_at is null;
alter table public.comeback_pushes enable row level security;
-- No policies: only the service role (the crons) and owner_comeback_stats touch it.
revoke all on public.comeback_pushes from anon, authenticated;

-- Per step: pushes that reached a device, how many of those people logged something within 48 hours, and how many are
-- still inside their 48 hours. Test and staff accounts are left out, as on the rest of the Users page.
create or replace function public.owner_comeback_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;
  return (
    with p as (
      select c.stage, c.sent_at,
        c.returned_at is not null and c.returned_at <= c.sent_at + interval '48 hours' as back,
        c.returned_at is null and c.sent_at > now() - interval '48 hours' as waiting
      from comeback_pushes c
      join auth.users u on u.id = c.user_id
      where c.delivered
        and not exists (select 1 from usage_internal_users i where i.user_id = c.user_id)
        and not exists (select 1 from creator_owners o where o.email = lower(u.email))
    ),
    st(stage, day) as (values (1, 3), (2, 7), (3, 14)),
    counts as (
      select st.stage, st.day,
        count(p.stage)::int as sent,
        count(p.stage) filter (where p.back)::int as returned,
        count(p.stage) filter (where p.waiting)::int as waiting,
        count(p.stage) filter (where p.sent_at >= now() - interval '30 days')::int as sent_30d
      from st left join p on p.stage = st.stage
      group by st.stage, st.day
    )
    select jsonb_build_object(
      'generatedAt', now(),
      'windowHours', 48,
      'firstSentAt', (select min(sent_at) from p),
      'stages', (select jsonb_agg(jsonb_build_object(
          'stage', stage, 'day', day, 'sent', sent, 'returned', returned, 'waiting', waiting, 'sent30d', sent_30d,
          -- Of the pushes whose 48 hours are over.
          'returnedPct', case when sent - waiting > 0 then round(100.0 * returned / (sent - waiting), 1) end
        ) order by stage) from counts)
    )
  );
end $$;

revoke all on function public.owner_comeback_stats() from public, anon;
grant execute on function public.owner_comeback_stats() to authenticated;
