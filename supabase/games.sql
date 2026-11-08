-- Website games (whatyouate.app/games): players and scoreboards. Additive only; nothing here touches the app's tables.
-- Players sign up once with a display name and an email (never shown publicly) and get a private token their browser
-- keeps; scores are posted with that token. Tables are locked (RLS on, no policies): everything goes through the
-- functions below, which are the only things the website's public key can call.
-- Boards: "today" = today's challenge (same food order for everyone, resets at midnight Toronto time);
-- "week" = best free-play score since Monday; "all" = best free-play score ever.
-- Email verification is planned (6-digit code via Resend); until then an email is not proven to belong to the player.

create table if not exists public.game_players (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),   -- stored lowercase so the same address can't sign up twice
  name text not null,
  token uuid not null unique default gen_random_uuid(),   -- the browser's key for posting scores; never shown publicly
  notify_beaten boolean not null default false,            -- "email me if someone beats my score"
  marketing_opt_in boolean not null default false,         -- "send me WhatYouAte updates" (CASL: separate, unticked by default)
  consent_at timestamptz,                                  -- when either box was ticked
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_scores (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.game_players(id) on delete cascade,
  game text not null default 'snack-merge',
  mode text not null check (mode in ('daily', 'free')),
  day date not null,                                       -- Toronto date the run was played
  score integer not null check (score >= 0),
  drops integer not null default 0,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, game, mode, day)                      -- one row per player per board per day: their best
);
create index if not exists game_scores_board on public.game_scores (game, mode, day, score desc);

create table if not exists public.game_submissions (       -- every attempt, for rate limiting and spotting cheats
  id bigint generated always as identity primary key,
  player_id uuid references public.game_players(id) on delete cascade,
  game text, mode text, score integer, drops integer, duration_ms integer, accepted boolean, reason text,
  created_at timestamptz not null default now()
);
create index if not exists game_submissions_recent on public.game_submissions (player_id, created_at desc);

alter table public.game_players enable row level security;
alter table public.game_scores enable row level security;
alter table public.game_submissions enable row level security;

create or replace function public.game_today() returns date language sql stable as $$
  select (now() at time zone 'America/Toronto')::date
$$;

-- Why a display name can't be used, or null when it can.
create or replace function public.game_name_problem(p_name text)
returns text language plpgsql immutable as $$
declare n text := btrim(coalesce(p_name, '')); u text := upper(regexp_replace(n, '[^A-Za-z0-9]', '', 'g'));
begin
  if length(n) < 2 then return 'short'; end if;
  if length(n) > 20 then return 'long'; end if;
  if n !~ '^[A-Za-z0-9 _.\-]+$' then return 'characters'; end if;
  if u ~ '(FUCK|SHIT|BITCH|CUNT|DICK|NAZI|PORN|SEX|WHORE|SLUT|FAG|NIGG|RAPE|KILL|HITLER)' then return 'blocked'; end if;
  if u in ('WHATYOUATE', 'WYA', 'ADMIN', 'SUPPORT', 'OFFICIAL', 'STAFF', 'MODERATOR', 'INTEGRITYSTACK') then return 'reserved'; end if;
  return null;
end $$;

-- Sign up (or update your details). Returns the player's token, or an error code.
-- Until email verification exists, signing up with an email already on the board returns that player's token and
-- updates the name, so a player can move to a new phone. (Verification will close this.)
create or replace function public.game_register(p_name text, p_email text, p_notify boolean default false, p_marketing boolean default false)
returns json language plpgsql volatile security definer set search_path = public as $$
declare prob text := public.game_name_problem(p_name); e text := lower(btrim(coalesce(p_email, ''))); p game_players;
begin
  if prob is not null then return json_build_object('ok', false, 'error', 'name_' || prob); end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) > 200 then return json_build_object('ok', false, 'error', 'email'); end if;
  insert into game_players (email, name, notify_beaten, marketing_opt_in, consent_at)
  values (e, btrim(p_name), coalesce(p_notify, false), coalesce(p_marketing, false),
          case when coalesce(p_notify, false) or coalesce(p_marketing, false) then now() end)
  on conflict (email) do update set name = excluded.name,
    notify_beaten = excluded.notify_beaten, marketing_opt_in = excluded.marketing_opt_in,
    consent_at = coalesce(excluded.consent_at, game_players.consent_at), updated_at = now()
  returning * into p;
  return json_build_object('ok', true, 'token', p.token, 'name', p.name);
end $$;

-- Post a finished run. Keeps the player's best per board per day; rejects impossible runs.
create or replace function public.game_submit_score(p_token uuid, p_game text, p_mode text, p_score integer, p_drops integer, p_duration_ms integer)
returns json language plpgsql volatile security definer set search_path = public as $$
declare p game_players; why text; d date := public.game_today(); recent int; prev int;
begin
  select * into p from game_players where token = p_token;
  if p.id is null then return json_build_object('ok', false, 'error', 'unknown_player'); end if;
  select count(*) into recent from game_submissions where player_id = p.id and created_at > now() - interval '1 hour';
  why := case
    when p_game is distinct from 'snack-merge' then 'game'
    when p_mode not in ('daily', 'free') then 'mode'
    when recent >= 60 then 'too_many'
    when p_score is null or p_score < 0 or p_drops is null or p_drops < 1 or p_drops > 3000 then 'values'
    when p_duration_ms < p_drops * 450 then 'too_fast'            -- the game allows one drop every 0.55s
    when p_score > p_drops * 60 then 'too_high'                   -- far above what a drop can earn, even with combos
    else null end;
  insert into game_submissions (player_id, game, mode, score, drops, duration_ms, accepted, reason)
  values (p.id, p_game, p_mode, p_score, p_drops, p_duration_ms, why is null, why);
  if why is not null then return json_build_object('ok', false, 'error', why); end if;
  select score into prev from game_scores where player_id = p.id and game = p_game and mode = p_mode and day = d;
  insert into game_scores (player_id, game, mode, day, score, drops, duration_ms)
  values (p.id, p_game, p_mode, d, p_score, p_drops, p_duration_ms)
  on conflict (player_id, game, mode, day) do update set score = excluded.score, drops = excluded.drops,
    duration_ms = excluded.duration_ms, updated_at = now()
  where excluded.score > game_scores.score;
  return json_build_object('ok', true, 'best_today', greatest(coalesce(prev, 0), p_score), 'improved', p_score > coalesce(prev, -1));
end $$;

-- The best score per player on a board, ranked. Ties go to whoever got there first.
create or replace function public.game_board_rows(p_game text, p_board text)
returns table (player_id uuid, name text, score integer, reached timestamptz)
language sql stable security definer set search_path = public as $$
  with s as (
    select g.player_id, g.score, g.updated_at
    from game_scores g
    where g.game = p_game and (
      (p_board = 'today' and g.mode = 'daily' and g.day = public.game_today()) or
      (p_board = 'week' and g.mode = 'free' and g.day >= date_trunc('week', public.game_today())::date) or
      (p_board = 'all' and g.mode = 'free'))
  ), best as (
    select distinct on (s.player_id) s.player_id, s.score, s.updated_at from s order by s.player_id, s.score desc, s.updated_at
  )
  select b.player_id, p.name, b.score, b.updated_at from best b join game_players p on p.id = b.player_id
$$;

-- Public scoreboard: names and scores only, never emails or tokens.
create or replace function public.game_leaderboard(p_game text default 'snack-merge', p_board text default 'today', p_limit integer default 50)
returns table (rank bigint, name text, score integer)
language sql stable security definer set search_path = public as $$
  select row_number() over (order by r.score desc, r.reached), r.name, r.score
  from public.game_board_rows(p_game, p_board) r
  order by r.score desc, r.reached
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- Where you stand on a board, even outside the top 50.
create or replace function public.game_my_rank(p_token uuid, p_game text default 'snack-merge', p_board text default 'today')
returns json language sql stable security definer set search_path = public as $$
  with ranked as (
    select r.player_id, r.score, row_number() over (order by r.score desc, r.reached) as rank, count(*) over () as total
    from public.game_board_rows(p_game, p_board) r
  )
  select coalesce((select json_build_object('rank', ranked.rank, 'score', ranked.score, 'total', ranked.total)
                   from ranked join game_players p on p.id = ranked.player_id where p.token = p_token), json_build_object('rank', null))
$$;

revoke all on function public.game_board_rows(text, text) from public, anon, authenticated;
grant execute on function public.game_register(text, text, boolean, boolean) to anon, authenticated;
grant execute on function public.game_submit_score(uuid, text, text, integer, integer, integer) to anon, authenticated;
grant execute on function public.game_leaderboard(text, text, integer) to anon, authenticated;
grant execute on function public.game_my_rank(uuid, text, text) to anon, authenticated;
grant execute on function public.game_name_problem(text) to anon, authenticated;
