-- Activity-celebration markers — which activity moments the app has already celebrated, so each
-- fires once and survives a device switch (localStorage is per-device and can be evicted, which
-- would re-fire a "welcome back" on a new phone).
-- Shape: { "lastComeback": "YYYY-MM-DD"|null, "lastConsistencyWin": "YYYY-MM-DD"|null }
-- Run once in the Supabase SQL editor. Safe to re-run (add column if not exists).

alter table profiles
  add column if not exists activity_celebration_json jsonb not null default '{}'::jsonb;
