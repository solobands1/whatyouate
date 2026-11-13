-- Blenders & Bacon: adds the game to the scoreboard and to the website visit counts. 2026-11-13.
-- Safe to run more than once. It only replaces two functions with the same versions as games.sql and attribution.sql.

create or replace function public.game_score_problem(p_game text, p_mode text, p_score integer, p_drops integer, p_duration_ms integer)
returns text language plpgsql immutable as $$
declare secs numeric := greatest(coalesce(p_duration_ms, 0), 0) / 1000.0;
begin
  return case
    when p_game is null or p_game not in ('snack-merge', 'beat-the-crash', 'cart-rush', 'berry-dash', 'food-fling', 'food-fight', 'sugar-showdown', 'fridge-raid', 'pea-tanks', 'food-rally', 'melon-bowling', 'kitchen-golf', 'blenders-bacon') then 'game'
    when p_mode not in ('daily', 'free') then 'mode'
    when p_score is null or p_score < 0 or p_drops is null or p_drops < 0 or p_drops > 3000 or p_duration_ms is null then 'values'
    -- Snack Merge: one drop every 0.55s at most; a drop can't earn more than 60, even with combos
    when p_game = 'snack-merge' and p_drops < 1 then 'values'
    when p_game = 'snack-merge' and p_duration_ms < p_drops * 450 then 'too_fast'
    when p_game = 'snack-merge' and p_score > p_drops * 60 then 'too_high'
    -- Beat The Crash: at most 60 points a second, 15 a food, and a 600 bonus per 75-second day; foods fall about 2 a second
    when p_game = 'beat-the-crash' and p_drops > secs * 3 + 5 then 'too_fast'
    when p_game = 'beat-the-crash' and p_score > secs * 70 + p_drops * 20 + 700 * (1 + secs / 75) then 'too_high'
    -- Cart Rush: drops = items grabbed. Speed rises 2.2 px/s each second from 230; one item per row at most, rows 185px+ apart;
    -- a point per 20px, 20 per item, recipe n (3+ grabs each) pays at most 200 * least(n, 10)
    when p_game = 'cart-rush' and p_drops > (secs * 230 + secs * secs * 1.1) / 185 + 3 then 'too_fast'
    when p_game = 'cart-rush' and p_score > secs * 11.5 + secs * secs * 0.055 + p_drops * 20
      + 100 * least(p_drops / 3.0, 10) * (least(p_drops / 3.0, 10) + 1) + 2000 * greatest(p_drops / 3.0 - 10, 0) + 100 then 'too_high'
    -- Berry Dash: drops = pickups. Top speed 650 px/s, 1.3x in a sugar rush (about 42 m/s); 15 points a pickup at most
    when p_game = 'berry-dash' and p_drops > secs * 4 + 10 then 'too_fast'
    when p_game = 'berry-dash' and p_score > secs * 45 + p_drops * 15 + 100 then 'too_high'
    -- Food Fling: drops = fruits flung; each fling's physics runs at least 0.67s in real time; Today is 10 levels x 3 fruits.
    -- A fling earns at most 100+200+...+1000 plus 100 a junk for distance (6,500); a cleared level adds at most 2,250; a full day adds 1,000
    when p_game = 'food-fling' and p_drops < 1 then 'values'
    when p_game = 'food-fling' and p_mode = 'daily' and p_drops > 30 then 'values'
    when p_game = 'food-fling' and p_duration_ms < p_drops * 500 then 'too_fast'
    when p_game = 'food-fling' and p_score > p_drops * 9000 + 1000 then 'too_high'
    -- Food Fight: drops = foods thrown at the computer (live and same-phone matches post nothing). Today is best of 3 rounds,
    -- 12 throws each at most. Every throw is followed by its flight, a pause and the computer's turn, so well over 0.5s each.
    -- A won round pays at most 500 (damage) + 500 + 1,000 (health left) + 700 (few throws) and takes at least 3 throws;
    -- a lost round pays at most 200 a throw; so under 900 a throw, plus 1,000 for winning the day
    when p_game = 'food-fight' and p_drops < 1 then 'values'
    when p_game = 'food-fight' and p_mode = 'daily' and p_drops > 36 then 'values'
    when p_game = 'food-fight' and p_duration_ms < p_drops * 500 then 'too_fast'
    when p_game = 'food-fight' and p_score > p_drops * 900 + 1000 then 'too_high'
    -- Sugar Showdown: drops = questions answered. Today is always exactly 10; Free Play ends at the 3rd wrong answer, so
    -- drops - 3 were right. A right answer is 500 plus up to 500 for speed, a wrong one 0. Every answer shows the grams for
    -- at least 1.7s before the next question or the end, so 1.5s an answer is a safe floor. Live and same-phone duels post nothing
    when p_game = 'sugar-showdown' and p_mode = 'daily' and p_drops <> 10 then 'values'
    when p_game = 'sugar-showdown' and p_mode = 'free' and p_drops < 3 then 'values'
    when p_game = 'sugar-showdown' and p_duration_ms < p_drops * 1500 then 'too_fast'
    when p_game = 'sugar-showdown' and p_mode = 'daily' and p_score > 10000 then 'too_high'
    when p_game = 'sugar-showdown' and p_mode = 'free' and p_score > (p_drops - 3) * 1000 then 'too_high'
    -- Fridge Raid: drops = shelves your moves checked, summed over rounds (7x7 fridge, 12 snack cells; a bite earns another
    -- shot, so a lost round can be very short). Today is one round: at most 49 shelves plus 4 lit shelves bitten later. Each shot is followed by
    -- the computer's turn (0.75s or more). A round pays at most 670 for hits + 340 for snacks found + a win bonus of
    -- 400 + 35 per shot under 64 + 210 for hidden cells: 3,370 at 14 shots, which is under 245 a shot
    when p_game = 'fridge-raid' and p_drops < 1 then 'values'
    when p_game = 'fridge-raid' and p_mode = 'daily' and p_drops > 53 then 'values'
    when p_game = 'fridge-raid' and p_duration_ms < p_drops * 600 then 'too_fast'
    when p_game = 'fridge-raid' and p_score > p_drops * 245 + 100 then 'too_high'
    -- Pea Tanks: drops = peas fired plus jelly mines dropped, in solo Missions (co-op, Guard The Lunch and versus post
    -- nothing). A cleared mission pays at most 1,000 + 150 x 4 enemies + 600 (speed) + 500 (aim) = 2,700, each starting
    -- with a card and a 1.8-second countdown, so well under 900 points a second. Today is 5 missions: at most 13,500 + 500
    -- a life left (3) + 1,000 for clearing all 5 = 16,000. The Free Play campaign is at most 20 missions with a bonus life
    -- every 5: 54,000 + 3,500 + 1,000 = 58,500. A pea every 0.17s at the very fastest (with Chili Peas)
    when p_game = 'pea-tanks' and p_drops < 1 then 'values'
    when p_game = 'pea-tanks' and (p_duration_ms < 4000 or p_duration_ms < p_drops * 150) then 'too_fast'
    when p_game = 'pea-tanks' and p_mode = 'daily' and p_score > 16000 then 'too_high'
    when p_game = 'pea-tanks' and p_score > 58500 then 'too_high'
    when p_game = 'pea-tanks' and p_score > p_duration_ms * 0.9 + 3000 then 'too_high'
    -- Food Rally: drops = laps finished, always 3 (live and same-phone races post nothing). Today is a 3-lap time trial
    -- paying 1,000 for finishing plus 100 a second under the course's par (about 3,600 at most; 4,000 leaves room).
    -- Free Play pays 400 to 2,000 for the place plus 50 a second under par (about 3,300; 3,600 with room). The quickest
    -- course takes over 25 s, after a 3-second countdown
    when p_game = 'food-rally' and p_drops <> 3 then 'values'
    when p_game = 'food-rally' and p_mode = 'daily' and p_score < 1000 then 'values'
    when p_game = 'food-rally' and p_duration_ms < 25000 then 'too_fast'
    when p_game = 'food-rally' and p_mode = 'daily' and p_score > 4000 then 'too_high'
    when p_game = 'food-rally' and p_score > 3600 then 'too_high'
    -- Melon Bowling: drops = balls you rolled in one 10-frame game against the computer (live and same-phone games post
    -- nothing), so 11 to 21. Every ball rolls, settles and is swept (well over 1.5s). Score = 10 x the bowling score
    -- (300 at most) + up to 20 for each full rack where you hit the pocket (12 at most) + 300 for beating the computer
    when p_game = 'melon-bowling' and (p_drops < 11 or p_drops > 21) then 'values'
    when p_game = 'melon-bowling' and p_duration_ms < p_drops * 1500 then 'too_fast'
    when p_game = 'melon-bowling' and p_score > 3540 then 'too_high'
    -- Kitchen Golf: drops = the round's total strokes (a picked-up hole counts 7), so 9 to 63 for Today's 9 holes. Every
    -- putt rolls and settles (well over 0.6s). A hole pays at most 1,125 (a one-stroke hole under par, beating the
    -- computer) and the round bonus is 500
    when p_game = 'kitchen-golf' and p_drops < 9 then 'values'
    when p_game = 'kitchen-golf' and p_mode = 'daily' and p_drops > 63 then 'values'
    when p_game = 'kitchen-golf' and p_duration_ms < p_drops * 600 then 'too_fast'
    when p_game = 'kitchen-golf' and p_score > p_drops * 1200 + 500 then 'too_high'
    -- Blenders & Bacon: drops = your turns in one race against the computer up the 96-square pantry (live and same-phone
    -- races post nothing). Every turn rolls a die that tumbles for over a second, then the computer takes its turn, so
    -- 1.5 s a turn is a safe floor. A win scores 500 + 40 for each turn under 60; a loss scores 5 a square (95 at most,
    -- so 475). So the score can never beat that formula for its number of turns
    when p_game = 'blenders-bacon' and (p_drops < 1 or p_drops > 400) then 'values'
    when p_game = 'blenders-bacon' and p_duration_ms < p_drops * 1500 then 'too_fast'
    when p_game = 'blenders-bacon' and p_score > greatest(500 + 40 * greatest(0, 60 - p_drops), 475) then 'too_high'
    else null end;
end $$;
revoke all on function public.game_score_problem(text, text, integer, integer, integer) from public, anon, authenticated;

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
                              'fridge-raid', 'pea-tanks', 'kitchen-golf', 'blenders-bacon') then
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
revoke all on function public.web_event(text, text, text) from public;
grant execute on function public.web_event(text, text, text) to anon, authenticated;

-- Check: both lines should say true
select public.game_score_problem('blenders-bacon', 'daily', 1460, 36, 200000) is null as score_ok,
       public.game_score_problem('blenders-bacon', 'daily', 9999, 36, 200000) = 'too_high' as cheat_blocked;
