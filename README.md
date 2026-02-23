# WhatYouAte AI (V1)

Local-first food photo logging and workout moments with calm, non-judgmental guidance.

## Setup

1. Install dependencies

```bash
npm install
```

2. Create `.env.local`

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
# Optional
AI_PROVIDER=openai
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-5-sonnet-20240620
```

3. Supabase setup

Create tables and policies (SQL in Supabase):

```sql
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  height integer,
  weight integer,
  age integer,
  sex text,
  goal_direction text,
  body_priority text,
  units text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  image_optional text,
  analysis_json jsonb,
  approx_calories integer,
  approx_protein integer,
  approx_carbs integer,
  approx_fat integer,
  range_fields_if_kept jsonb,
  confidence double precision,
  user_corrections_json jsonb
);

create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  start_ts timestamptz,
  end_ts timestamptz,
  duration_min integer,
  start_image_optional text,
  end_image_optional text
);

alter table profiles enable row level security;
alter table meals enable row level security;
alter table workouts enable row level security;

create policy "profiles_own" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "meals_own" on meals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "workouts_own" on workouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

4. Run the app

```bash
npm run dev
```

## Run On Your Phone (Local Network)

1. Find your machine IP (example: `192.168.1.20`).
2. Start the dev server and bind to your LAN:

```bash
npm run dev -- -H 0.0.0.0
```

3. Open `http://YOUR_IP:3000` on your phone.

## Install As A PWA (iOS)

1. Open the app in Safari.
2. Tap the Share icon.
3. Tap **Add to Home Screen**.
4. Launch from the new icon for the full-screen experience.

## Notes

- Data is stored per user in Supabase (Postgres + Auth).
- Login uses email magic links via Supabase Auth.
- The AI route is `/api/analyze-food` and runs server-side to keep keys off the client.
