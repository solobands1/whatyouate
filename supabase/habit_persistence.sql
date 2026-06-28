-- Habit builder + nightly reflection persistence.
--   habit_state_json:   the current/suggested builder plus cadence bookkeeping
--                       (cooldowns, snooze counts, last-ended timestamp). One object or null.
--   habit_history_json: completed builders (title, duration, finished date, keep answer).
--   reflections_json:   nightly check-ins (date, answers, note).
-- Run once in the Supabase SQL editor.

alter table profiles
  add column if not exists habit_state_json jsonb,
  add column if not exists habit_history_json jsonb not null default '[]'::jsonb,
  add column if not exists reflections_json jsonb not null default '[]'::jsonb;
