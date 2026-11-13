-- "Remind Me After Breakfast" from the first-meal step at the end of onboarding.
-- The app writes the chosen time here (a whole hour, usually 8 to 11 AM local). The hourly
-- /api/cron/reminder job sends one push at the first run at or after it, unless the user has
-- logged a meal that day, then sets it back to null so it only ever fires once.
--
-- Run once in the Supabase SQL editor BEFORE deploying the web change. Safe to re-run.
-- Until it's run, the app still works: the write fails, is handled, and the reminder falls back
-- to an in-app prompt on the next open, and the cron skips the push.

alter table profiles
  add column if not exists first_meal_reminder_at timestamptz;

-- The cron looks for due rows across all users; keep that lookup cheap.
create index if not exists profiles_first_meal_reminder_at_idx
  on profiles (first_meal_reminder_at)
  where first_meal_reminder_at is not null;
