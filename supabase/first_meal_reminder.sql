-- Reminders from the first-meal step at the end of onboarding: "Remind Me After Breakfast"
-- (8 to 11 AM local) and the one follow-up after "Not Now" (1 PM lunch, 7 PM dinner or 9 AM the
-- next morning). The app writes the chosen time here, a whole hour. The hourly /api/cron/reminder
-- job sends one push at the first run at or after it, unless the user has logged a meal since,
-- then sets it back to null so it only ever fires once. The message (breakfast, lunch or dinner)
-- comes from the time's local hour via profiles.timezone_offset_minutes, so there is no kind
-- column.
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

-- Added with the "Not Now" follow-up: when a first-meal reminder push last went out. The cron's
-- first-week 2pm "What Did You Have For Lunch?" push (onboarded users with no meals, days 1 to 7)
-- skips any day one already went out. Until this column exists, that 2pm push stays off and
-- everything else works as before. Safe to re-run.
alter table profiles
  add column if not exists first_meal_nudged_at timestamptz;
