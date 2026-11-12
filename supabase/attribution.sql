-- Website attribution for the owner (whatyouate.app/creators/owner/attribution): where website visits come from
-- (TikTok, YouTube, Instagram, Facebook, the game videos' end card, shared links, search) and what those visitors do
-- (open a game, finish a round, tap an App Store link, share).
--
-- Additive only. It adds one small table (web_events_daily) and two functions. No existing table, column or function is
-- changed, so running it cannot change how the app or the site behaves. Safe to rerun.
--
-- Privacy: nothing about a visitor is stored. The site (components/track.ts in the web repo) only ever sends
-- (source, event, page), and this file only keeps a running count per Toronto day. No cookies, no user ids, no IP
-- addresses, no user agents, no per-visitor rows.
--
-- What the site sends:
--   visit      once per browser session per source, on the first page they land on
--   game_open  a game page loads, once per session per game
--   game_play  the first finished round of a game in that session
--   app_click  a tap on any App Store link (the page it was tapped on is the path)
--   share      a tap on a game's Share button
--
-- owner_attribution checks creator_is_owner() from creators.sql, so run creators.sql first.

-- ---- Daily counts ------------------------------------------------------------------------------------------------------
-- One row per (day, source, event, page) with a count. The values are clamped by web_event to short fixed lists, so a day
-- can have at most a few hundred rows however much traffic there is. fillfactor leaves room in each page so the +1
-- updates stay "HOT" (no index writes), which keeps Disk IO tiny.
create table if not exists public.web_events_daily (
  day date not null,
  source text not null,
  event text not null,
  path text not null,
  n integer not null default 0,
  primary key (day, source, event, path)
) with (fillfactor = 70);
alter table public.web_events_daily enable row level security;
-- No policies: nobody reads or writes it directly. web_event adds to it; owner_attribution reads it.
revoke all on table public.web_events_daily from public, anon, authenticated;

comment on table public.web_events_daily is
  'Website counts per Toronto day, by source, event and page. No visitor data. Written by web_event, read by owner_attribution (attribution.sql).';

-- ---- Counting one event (anyone can call it; the site calls it without signing in) ---------------------------------------
-- Adds 1 to today's count. Anything unexpected is cleaned up rather than refused:
--   event   must be one of the five above, otherwise nothing is counted
--   source  one of the known sources, otherwise 'other'
--   path    '/', '/games', '/play' or '/games/<slug>' for a known game; other game pages become '/games/other' and every
--           other page '/other'. game_open and game_play only count on a game page.
-- Flood guard: a single row stops growing at 100,000 in a day, so nobody can push one number to silly heights. Because
-- every value comes from a short list, the table can't be filled with junk rows either.
-- New games: add the slug to the list below (and to components/games/catalog.ts on the site). Until then they count
-- under '/games/other'.
create or replace function public.web_event(p_source text, p_event text, p_path text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  ev text := lower(coalesce(p_event, ''));
  src text := lower(btrim(coalesce(p_source, '')));
  pth text := lower(left(coalesce(p_path, ''), 64));
begin
  if ev not in ('visit', 'game_open', 'game_play', 'app_click', 'share') then return; end if;

  if src not in ('tiktok', 'youtube', 'instagram', 'facebook', 'video', 'tiktok-video', 'youtube-video', 'instagram-video',
                 'share', 'google', 'other-search', 'direct', 'other') then
    src := 'other';
  end if;

  pth := rtrim(pth, '/');
  if pth = '' then pth := '/'; end if;
  if pth in ('/', '/games', '/play') then
    null;
  elsif pth like '/games/%' then
    if substr(pth, 8) not in ('snack-merge', 'beat-the-crash', 'cart-rush', 'berry-dash', 'food-fling', 'food-fight',
                              'fridge-raid', 'pea-tanks', 'kitchen-golf') then
      pth := '/games/other';
    end if;
  else
    pth := '/other';
  end if;
  if ev in ('game_open', 'game_play') and pth not like '/games/%' then return; end if;

  insert into public.web_events_daily as w (day, source, event, path, n)
  values ((now() at time zone 'America/Toronto')::date, src, ev, pth, 1)
  on conflict (day, source, event, path) do update set n = w.n + 1
    where w.n < 100000;
end $$;

comment on function public.web_event(text, text, text) is
  'Adds 1 to today''s website count for (source, event, page). Values are clamped to fixed lists. Called by components/track.ts on whatyouate.app.';

-- ---- Owner page ---------------------------------------------------------------------------------------------------------
-- Everything the attribution page shows for the last p_days days (Toronto days, today included), in one call:
--   totals   each event added up, plus the overall tap rate
--   sources  one row per source: the five counts and tapRate (App Store taps per 100 visits)
--   daily    one row per day in the window (days with nothing show zeros)
--   games    each game page: opens, plays, App Store taps and shares, most opened first
-- It reads only the window's rows, through the primary key (day comes first), so it touches a few thousand rows at most.
create or replace function public.owner_attribution(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d integer := least(greatest(coalesce(p_days, 30), 1), 366);
  today date := (now() at time zone 'America/Toronto')::date;
  since date := today - (d - 1);
  result jsonb;
begin
  if not public.creator_is_owner() then raise exception 'not_owner'; end if;

  with w as (
    select day, source, event, path, n from public.web_events_daily where day between since and today
  ),
  tot as (
    select coalesce(sum(n) filter (where event = 'visit'), 0)::int as visit,
           coalesce(sum(n) filter (where event = 'game_open'), 0)::int as game_open,
           coalesce(sum(n) filter (where event = 'game_play'), 0)::int as game_play,
           coalesce(sum(n) filter (where event = 'app_click'), 0)::int as app_click,
           coalesce(sum(n) filter (where event = 'share'), 0)::int as share
    from w
  ),
  by_source as (
    select source,
           coalesce(sum(n) filter (where event = 'visit'), 0)::int as visit,
           coalesce(sum(n) filter (where event = 'game_open'), 0)::int as game_open,
           coalesce(sum(n) filter (where event = 'game_play'), 0)::int as game_play,
           coalesce(sum(n) filter (where event = 'app_click'), 0)::int as app_click,
           coalesce(sum(n) filter (where event = 'share'), 0)::int as share
    from w group by source
  ),
  by_day as (
    select day,
           coalesce(sum(n) filter (where event = 'visit'), 0)::int as visit,
           coalesce(sum(n) filter (where event = 'game_open'), 0)::int as game_open,
           coalesce(sum(n) filter (where event = 'game_play'), 0)::int as game_play,
           coalesce(sum(n) filter (where event = 'app_click'), 0)::int as app_click,
           coalesce(sum(n) filter (where event = 'share'), 0)::int as share
    from w group by day
  ),
  by_game as (
    select substr(path, 8) as slug,
           coalesce(sum(n) filter (where event = 'game_open'), 0)::int as opens,
           coalesce(sum(n) filter (where event = 'game_play'), 0)::int as plays,
           coalesce(sum(n) filter (where event = 'app_click'), 0)::int as app_clicks,
           coalesce(sum(n) filter (where event = 'share'), 0)::int as shares
    from w where path like '/games/%' group by path
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'days', d,
    'from', since,
    'to', today,
    'totals', (
      select jsonb_build_object('visit', visit, 'game_open', game_open, 'game_play', game_play, 'app_click', app_click,
        'share', share, 'tapRate', case when visit > 0 then round(100.0 * app_click / visit, 1) end)
      from tot),
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object('source', source, 'visit', visit, 'game_open', game_open,
        'game_play', game_play, 'app_click', app_click, 'share', share,
        'tapRate', case when visit > 0 then round(100.0 * app_click / visit, 1) end)
        order by visit desc, app_click desc, source), '[]'::jsonb)
      from by_source),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'visit', coalesce(b.visit, 0),
        'game_open', coalesce(b.game_open, 0), 'game_play', coalesce(b.game_play, 0),
        'app_click', coalesce(b.app_click, 0), 'share', coalesce(b.share, 0)) order by g.day), '[]'::jsonb)
      from (select generate_series(since::timestamp, today::timestamp, interval '1 day')::date as day) g
      left join by_day b on b.day = g.day),
    'games', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'opens', opens, 'plays', plays,
        'appClicks', app_clicks, 'shares', shares) order by opens desc, plays desc, slug), '[]'::jsonb)
      from by_game)
  ) into result;

  return result;
end $$;

comment on function public.owner_attribution(integer) is
  'Owner only. Website counts for the last p_days Toronto days: totals, by source (with App Store taps per 100 visits), by day and by game.';

-- ---- Permissions --------------------------------------------------------------------------------------------------------
-- Supabase grants new functions to anon and authenticated by default, so both are set explicitly.
revoke all on function public.web_event(text, text, text) from public;
grant execute on function public.web_event(text, text, text) to anon, authenticated;

revoke all on function public.owner_attribution(integer) from public, anon;
grant execute on function public.owner_attribution(integer) to authenticated;

-- ---- Housekeeping (optional, not run here) ----------------------------------------------------------------------------
-- The table grows by a few hundred rows a day at most, so it can be left alone for years. To trim it later:
-- delete from public.web_events_daily where day < (now() at time zone 'America/Toronto')::date - 400;
