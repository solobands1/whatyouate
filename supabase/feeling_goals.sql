-- Feeling-oriented goal(s): what the user wants to feel better about.
-- Primary, feeling-oriented goal of the app (distinct from the body/weight goal_direction).
-- Drives habit selection + coach framing.
-- Run once in the Supabase SQL editor.

alter table profiles
  add column if not exists feeling_goals text[] not null default '{}';
