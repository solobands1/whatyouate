-- Streak-saver "freeze" state — the capped safety net that bridges a single missed day.
-- Stored on the profile next to streak / streak_last_date so the forgiven days and the weekly
-- rescue cap are durable and consistent across devices (they were in localStorage, which is
-- per-device and can be evicted, letting the cap leak or reset).
-- Shape: { "forgiven": ["YYYY-MM-DD", ...], "rescueLast": "YYYY-MM-DD"|null, "ack": "YYYY-MM-DD"|null }
-- Run once in the Supabase SQL editor.

alter table profiles
  add column if not exists streak_saver_json jsonb not null default '{}'::jsonb;
