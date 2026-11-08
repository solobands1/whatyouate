-- Daily logo prize for the website games (whatyouate.app/games). Once a day a gold WhatYouAte logo floats across
-- a game; a player who catches it, has joined the scoreboard and answers the skill-testing question gets one
-- one-time App Store offer code (30 days of Pro). Limits: a daily cap across everyone (game_prize_settings),
-- one prize per player ever, one claim attempt per player per day. Off until game_prize_settings.enabled = true.
-- Codes come from App Store Connect (one-time offer codes) and are loaded into game_prize_codes with the
-- service role. Tables are locked (RLS on, no policies); the site only calls the functions below.
-- Depends on games.sql (game_players, game_today).

create table if not exists public.game_prize_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  daily_limit int not null default 3
);
insert into public.game_prize_settings (id) values (1) on conflict do nothing;

create table if not exists public.game_prize_codes (
  id bigint generated always as identity primary key,
  code text not null unique,
  player_id uuid unique references public.game_players(id) on delete set null,   -- one prize per player, ever
  game text,
  claimed_at timestamptz,                                                         -- set once handed out, never cleared
  claimed_day date,
  created_at timestamptz not null default now()
);
create index if not exists game_prize_codes_day on public.game_prize_codes (claimed_day);

create table if not exists public.game_prize_attempts (
  player_id uuid not null references public.game_players(id) on delete cascade,
  day date not null,
  game text,
  result text,
  created_at timestamptz not null default now(),
  primary key (player_id, day)                                                    -- one try a day
);

alter table public.game_prize_settings enable row level security;
alter table public.game_prize_codes enable row level security;
alter table public.game_prize_attempts enable row level security;

-- Whether the logo should show today: on, with prizes left.
create or replace function public.game_prize_status()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'on', s.enabled and exists (select 1 from game_prize_codes where claimed_at is null),
    'left', greatest(0, least(
      s.daily_limit - (select count(*) from game_prize_codes where claimed_day = public.game_today()),
      (select count(*) from game_prize_codes where claimed_at is null))))
  from game_prize_settings s where s.id = 1
$$;

-- Claim a prize after catching the logo. Returns the code, or why not.
create or replace function public.game_prize_claim(p_token uuid, p_game text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare p game_players; s game_prize_settings; d date := public.game_today(); c text; n int;
begin
  select * into p from game_players where token = p_token;
  if p.id is null then return json_build_object('ok', false, 'error', 'unknown_player'); end if;
  select * into s from game_prize_settings where id = 1;
  select code into c from game_prize_codes where player_id = p.id;
  if c is not null then return json_build_object('ok', true, 'code', c, 'again', true); end if;   -- already won: show it again
  if not s.enabled then return json_build_object('ok', false, 'error', 'off'); end if;
  insert into game_prize_attempts (player_id, day, game) values (p.id, d, p_game) on conflict do nothing;
  if not found then return json_build_object('ok', false, 'error', 'tried_today'); end if;
  perform pg_advisory_xact_lock(hashtext('game_prize_claim'));                     -- one claim at a time, so the cap holds
  select count(*) into n from game_prize_codes where claimed_day = d;
  if n >= s.daily_limit then
    update game_prize_attempts set result = 'gone' where player_id = p.id and day = d;
    return json_build_object('ok', false, 'error', 'gone');
  end if;
  update game_prize_codes set player_id = p.id, game = p_game, claimed_at = now(), claimed_day = d
  where id = (select id from game_prize_codes where claimed_at is null order by id limit 1 for update skip locked)
  returning code into c;
  if c is null then
    update game_prize_attempts set result = 'no_codes' where player_id = p.id and day = d;
    return json_build_object('ok', false, 'error', 'gone');
  end if;
  update game_prize_attempts set result = 'won' where player_id = p.id and day = d;
  return json_build_object('ok', true, 'code', c);
end $$;

-- A winner's code, to show it again later.
create or replace function public.game_prize_mine(p_token uuid)
returns json language sql stable security definer set search_path = public as $$
  select coalesce((select json_build_object('code', c.code) from game_prize_codes c join game_players p on p.id = c.player_id
                   where p.token = p_token), json_build_object('code', null))
$$;

grant execute on function public.game_prize_status() to anon, authenticated;
grant execute on function public.game_prize_claim(uuid, text) to anon, authenticated;
grant execute on function public.game_prize_mine(uuid) to anon, authenticated;
