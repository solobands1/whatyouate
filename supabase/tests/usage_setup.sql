-- Stand-in for Supabase for testing owner_usage.sql locally: auth schema, roles, and the app tables (only the columns
-- owner_usage.sql reads, with the production types). Run creators.sql after this, then owner_usage.sql.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now(),
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.profiles (
  id uuid default gen_random_uuid(),
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text, last_name text,
  timezone_offset_minutes integer,
  onboarding_done boolean, walkthrough_done boolean,
  reflections_json jsonb, water_logs_json jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  analysis_json jsonb, created_at timestamptz default now(), ts bigint, status text
);
create table public.feel_logs (id uuid primary key default gen_random_uuid(), user_id uuid, ts bigint, tag text, created_at timestamptz default now());
create table public.workouts (id uuid primary key default gen_random_uuid(), user_id uuid, start_ts bigint, created_at timestamptz default now());
create table public.weight_logs (id uuid primary key default gen_random_uuid(), user_id uuid, weight_kg numeric, logged_at timestamptz default now());
create table public.step_logs (id uuid primary key default gen_random_uuid(), user_id uuid, date date, steps integer, synced_at timestamptz);
create table public.sleep_logs (id uuid primary key default gen_random_uuid(), user_id uuid, date date, hours numeric, synced_at timestamptz);
create table public.push_tokens (id uuid primary key default gen_random_uuid(), user_id uuid, token text, platform text,
  created_at timestamptz default now(), updated_at timestamptz default now());

grant usage on schema public to anon, authenticated, service_role;
-- Like Supabase: new tables and functions are granted to the API roles by default.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
