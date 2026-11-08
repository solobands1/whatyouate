-- Friend Duels for the website games (whatyouate.app/games). After today's challenge, a player taps "Challenge
-- Someone": we keep their name and score under a short code, and the link (?duel=CODE) lets one friend play the same
-- board that day. Both see who won; the challenger's browser checks back for the result. No sign-up needed for either
-- side (names only, checked like scoreboard names). Scores are checked with the same per-game limits as the scoreboard
-- (game_score_problem in games.sql). Locked table, reached only through the functions below. Depends on games.sql.

create table if not exists public.game_duels (
  code text primary key,
  game text not null,
  day date not null,                     -- Toronto date of the board; a duel only counts on that day
  a_name text not null,
  a_score integer not null,
  b_name text,
  b_score integer,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists game_duels_created on public.game_duels (created_at);
alter table public.game_duels enable row level security;

-- Start a duel from a finished Today run. Returns the code.
create or replace function public.game_duel_create(p_game text, p_score integer, p_drops integer, p_duration_ms integer, p_name text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare why text := public.game_score_problem(p_game, 'daily', p_score, p_drops, p_duration_ms);
        nm text := public.game_name_problem(p_name); c text; alphabet text := 'ACDEFHJKMNPRTWXY'; k int;
begin
  if why is not null then return json_build_object('ok', false, 'error', why); end if;
  if nm is not null then return json_build_object('ok', false, 'error', 'name_' || nm); end if;
  if (select count(*) from game_duels where created_at > now() - interval '1 minute') >= 120 then
    return json_build_object('ok', false, 'error', 'busy');
  end if;
  loop
    c := '';
    for k in 1..5 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from game_duels where code = c);
  end loop;
  insert into game_duels (code, game, day, a_name, a_score) values (c, p_game, public.game_today(), btrim(p_name), p_score);
  return json_build_object('ok', true, 'code', c, 'day', public.game_today());
end $$;

-- Look up duels by code (the challenger's browser keeps its codes; a friend opening a link looks up one).
create or replace function public.game_duel_get(p_codes text[])
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('code', code, 'game', game, 'day', day, 'today', day = public.game_today(),
    'a_name', a_name, 'a_score', a_score, 'b_name', b_name, 'b_score', b_score)), '[]'::json)
  from game_duels where code = any (p_codes[1:20])
$$;

-- The friend's answer: their Today score on the same board. First answer only, same day only.
create or replace function public.game_duel_answer(p_code text, p_score integer, p_drops integer, p_duration_ms integer, p_name text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare d game_duels; why text; nm text := public.game_name_problem(p_name);
begin
  select * into d from game_duels where code = upper(btrim(p_code)) for update;
  if d.code is null then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if d.b_score is not null then return json_build_object('ok', false, 'error', 'taken'); end if;
  if d.day <> public.game_today() then return json_build_object('ok', false, 'error', 'expired'); end if;
  why := public.game_score_problem(d.game, 'daily', p_score, p_drops, p_duration_ms);
  if why is not null then return json_build_object('ok', false, 'error', why); end if;
  if nm is not null then return json_build_object('ok', false, 'error', 'name_' || nm); end if;
  update game_duels set b_name = btrim(p_name), b_score = p_score, answered_at = now() where code = d.code;
  return json_build_object('ok', true, 'a_name', d.a_name, 'a_score', d.a_score, 'b_name', btrim(p_name), 'b_score', p_score);
end $$;

grant execute on function public.game_duel_create(text, integer, integer, integer, text) to anon, authenticated;
grant execute on function public.game_duel_get(text[]) to anon, authenticated;
grant execute on function public.game_duel_answer(text, integer, integer, integer, text) to anon, authenticated;
